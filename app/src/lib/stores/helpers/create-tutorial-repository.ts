import * as URL from 'url'
import * as Path from 'path'

import { Account } from '../../../models/account'
import { writeFile, pathExists, ensureDir } from 'fs-extra'
import { API, getDotComAPIEndpoint } from '../../api'
import { APIError } from '../../http'
import {
  executionOptionsWithProgress,
  PushProgressParser,
} from '../../progress'
import { envForAuthentication } from '../../git/authentication'
import { git } from '../../git'

const nl = __WIN32__ ? '\r\n' : '\n'
const InititalReadmeContents =
  `# Welcome to GitHub Desktop!${nl}${nl}` +
  `This is your README. READMEs are where you can communicate ` +
  `what your project is and how to use it.${nl}${nl}` +
  `Write your name on line 6, save it, and then head ` +
  `back to GitHub Desktop.${nl}`

async function createAPIRepository(account: Account, name: string) {
  const api = new API(account.endpoint, account.token)

  try {
    return await api.createRepository(
      null,
      name,
      'GitHub Desktop tutorial repository',
      true
    )
  } catch (err) {
    if (
      err instanceof APIError &&
      err.responseStatus === 422 &&
      err.apiError !== null
    ) {
      if (err.apiError.message === 'Repository creation failed.') {
        if (
          err.apiError.errors &&
          err.apiError.errors.some(
            x => x.message === 'name already exists on this account'
          )
        ) {
          throw new Error(
            'You already have a repository named ' +
              `"${name}" on your account at ${friendlyEndpointName(
                account
              )}.\n\n` +
              'Please delete the repository and try again.'
          )
        }
      }
    }

    throw err
  }
}

async function pushRepo(
  path: string,
  account: Account,
  progressCb: (title: string, value: number, description?: string) => void
) {
  const pushTitle = `Pushing repository to ${friendlyEndpointName(account)}`
  progressCb(pushTitle, 0)

  const pushOpts = await executionOptionsWithProgress(
    {
      env: envForAuthentication(account),
    },
    new PushProgressParser(),
    progress => {
      if (progress.kind === 'progress') {
        progressCb(pushTitle, progress.percent, progress.details.text)
      }
    }
  )

  const args = ['push', '-u', 'origin', 'master']
  await git(args, path, 'tutorial:push', pushOpts)
}

/**
 * Creates a repository on the remote (as specified by the Account
 * parameter), initializes an empty repository at the given path,
 * sets up the expected tutorial contents, and pushes the repository'
 * to the remote.
 *
 * @param path    The path on the local machine where the tutorial
 *                repository is to be created
 *
 * @param account The account (and thereby the GitHub host) under
 *                which the repository is to be created created
 */
export async function createTutorialRepository(
  account: Account,
  name: string,
  path: string,
  progressCb: (title: string, value: number, description?: string) => void
) {
  const endpointName = friendlyEndpointName(account)
  progressCb(`Creating repository on ${endpointName}`, 0)

  if (await pathExists(path)) {
    throw new Error(
      `The path '${path}' already exists. Please move it ` +
        'out of the way, or remove it, and then try again.'
    )
  }

  const repo = await createAPIRepository(account, name)

  progressCb('Initializing local repository', 0.2)

  await ensureDir(path)
  await git(['init'], path, 'tutorial:init')

  await writeFile(Path.join(path, 'README.md'), InititalReadmeContents)

  await git(['add', '--', 'README.md'], path, 'tutorial:add')
  await git(
    ['commit', '-m', 'Initial commit', '--', 'README.md'],
    path,
    'tutorial:commit'
  )
  await git(
    ['remote', 'add', 'origin', repo.clone_url],
    path,
    'tutorial:add-remote'
  )

  await pushRepo(path, account, (title, value, description) => {
    progressCb(title, 0.3 + value * 0.6, description)
  })

  progressCb('Finalizing tutorial repository', 0.9)

  return repo
}

/**
 * Generate a human-friendly description of the Account endpoint.
 *
 * Accounts on GitHub.com will return the string 'GitHub.com'
 * whereas GitHub Enterprise Server accounts will return the
 * hostname without the protocol and/or path.
 */
export function friendlyEndpointName(account: Account) {
  return account.endpoint === getDotComAPIEndpoint()
    ? 'GitHub.com'
    : URL.parse(account.endpoint).hostname || account.endpoint
}