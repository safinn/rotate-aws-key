#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CreateAccessKeyCommand,
  DeleteAccessKeyCommand,
  IAMClient,
  ListAccessKeysCommand,
} from '@aws-sdk/client-iam'
import { fromIni } from '@aws-sdk/credential-providers'

import {
  spinner,
  isCancel,
  intro,
  multiselect,
  cancel,
  outro,
  note,
  log,
} from '@clack/prompts'
import color from 'picocolors'
import { differenceInCalendarDays } from 'date-fns'
import argv from 'minimist'

const client = new IAMClient({})

async function listAccessKeys() {
  const data = await client.send(new ListAccessKeysCommand({}))
  return data.AccessKeyMetadata
}

async function createAccessKey() {
  const data = await client.send(new CreateAccessKeyCommand({}))
  if (!data.AccessKey) throw new Error('no access key created')

  return [data.AccessKey.AccessKeyId, data.AccessKey.SecretAccessKey]
}

async function deleteKey(key: string) {
  const data = await client.send(
    new DeleteAccessKeyCommand({
      AccessKeyId: key,
    })
  )
}

async function replaceCrendentials(
  profileName: string,
  accessKeyId: string,
  accessKeySecret: string,
  env: string | boolean
) {
  const credentialsPath = `${os.homedir}/.aws/credentials`
  const credentialsFile = await fs.readFile(credentialsPath, 'utf8')

  const newDefaultProfile = `[${profileName}]
aws_access_key_id=${accessKeyId}
aws_secret_access_key=${accessKeySecret}`

  const re = new RegExp(`^\\[${profileName}\\]\\s*.+\\s*.+$`, 'm')
  const newFile = credentialsFile.replace(re, newDefaultProfile)

  await fs.writeFile(credentialsPath, newFile)

  if (typeof env === 'string') {
    const envFilePath = path.resolve(env)

    try {
      let envFile = await fs.readFile(envFilePath, 'utf-8')
      envFile = envFile.replace(
        /^AWS_ACCESS_KEY_ID=.*$/m,
        `AWS_ACCESS_KEY_ID=${accessKeyId}`
      )
      envFile = envFile.replace(
        /^AWS_SECRET_ACCESS_KEY=.*$/m,
        `AWS_SECRET_ACCESS_KEY=${accessKeySecret}`
      )

      await fs.writeFile(envFilePath, envFile)
    } catch (err) {
      log.error(`Failed updating env file: ${envFilePath}\n${err}`)
    }
  }
}

async function getAllCredentialProfiles() {
  const credentialsPath = `${os.homedir}/.aws/credentials`
  const credentialsFile = await fs.readFile(credentialsPath, 'utf8')

  const matches = credentialsFile.match(/^\[.*\]$/gm)
  if (!matches) return []

  return matches.map((profile) => profile.slice(1, -1))
}

async function getAllProfiles(profiles: string[]) {
  const p = profiles.map(async (profile) => {
    const getProfile = fromIni({ profile: profile })
    const prof = await getProfile()
    return {
      name: profile,
      ...prof,
    }
  })

  const [accessKeys, ...allProfiles] = await Promise.all([
    listAccessKeys(),
    ...p,
  ])

  return allProfiles
    .map((profile) => {
      const foundKey = accessKeys?.find(
        (key) => key.AccessKeyId === profile.accessKeyId
      )

      return { ...profile, createDate: foundKey?.CreateDate }
    })
    .filter((key) => !!key.createDate)
}

async function run() {
  const args = argv(process.argv.slice(2), {
    alias: {
      profiles: ['p'],
      output: ['o'],
      env: ['e'],
    },
    boolean: ['profiles', 'output'],
  })

  // Set default env file to `.env` in the current directory
  if (args.env === true) {
    args.env = '.env'
  }

  console.log()
  intro(color.inverse(' rotate-aws-key '))

  let profiles = ['default']
  if (args.profiles) {
    try {
      profiles = await getAllCredentialProfiles()
    } catch (err) {
      log.error(err)
      process.exit(1)
    }
  }

  const allProfiles = await getAllProfiles(profiles)
  if (!allProfiles.length) {
    cancel('No existing access keys')
    return process.exit(0)
  }

  let selectedProfiles: string[] = ['default']
  if (args.profiles) {
    selectedProfiles = (await multiselect({
      message: 'Which profiles would you like to rotate?',
      options: allProfiles.map((profile) => ({
        value: profile.name,
        label: `${profile.name} ${color.dim(
          `${profile.accessKeyId} (${differenceInCalendarDays(
            new Date(),
            new Date(profile.createDate!)
          )}d)`
        )}`,
      })),
    })) as string[]

    if (isCancel(selectedProfiles)) {
      cancel('Operation cancelled')
      return process.exit(0)
    }
  }

  const selectedForRotation = allProfiles.filter((profile) =>
    selectedProfiles.includes(profile.name)
  )

  if (selectedForRotation.length > 2) {
    return log.error('Cannot rotate more than 2 access keys')
  }

  if (!selectedForRotation.length) {
    return outro('Nothing to rotate')
  }

  const plural = selectedForRotation.length > 1

  const s = spinner()
  s.start(`Rotating access key${plural ? 's' : ''}`)

  const rotated: {
    name: string
    key: string
    secret: string
  }[] = []

  for (const profile of selectedForRotation) {
    const [accessKeyId, accessKeySecret] = await createAccessKey()

    try {
      await replaceCrendentials(
        profile.name,
        accessKeyId!,
        accessKeySecret!,
        selectedForRotation.length === 1 ? args.env : false
      )
    } catch (err) {
      log.error(`Failed replacing credentials\n${err}`)
    }

    rotated.push({
      name: profile.name,
      key: accessKeyId!,
      secret: accessKeySecret!,
    })
  }

  s.stop(`Rotated ${selectedForRotation.length} access key${plural ? 's' : ''}`)

  // Delete rotated AWS access keys
  const del = selectedForRotation.map((profile) => {
    return deleteKey(profile.accessKeyId)
  })
  await Promise.all(del)

  // Output the rotated keys
  if (args.output) {
    rotated.forEach((k) => {
      note(
        `AWS_ACCESS_KEY_ID=${k.key}\nAWS_SECRET_ACCESS_KEY=${k.secret}`,
        k.name
      )
    })
  }

  outro('Complete')
}

run()
