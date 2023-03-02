#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const clientIam = require('@aws-sdk/client-iam');
const credentialProviders = require('@aws-sdk/credential-providers');
const prompts = require('@clack/prompts');
const color = require('picocolors');
const dateFns = require('date-fns');
const argv = require('minimist');

const client = new clientIam.IAMClient({});
async function listAccessKeys() {
  const data = await client.send(new clientIam.ListAccessKeysCommand({}));
  return data.AccessKeyMetadata;
}
async function createAccessKey() {
  const data = await client.send(new clientIam.CreateAccessKeyCommand({}));
  if (!data.AccessKey)
    throw new Error("no access key created");
  return [data.AccessKey.AccessKeyId, data.AccessKey.SecretAccessKey];
}
async function deleteKey(key) {
  await client.send(
    new clientIam.DeleteAccessKeyCommand({
      AccessKeyId: key
    })
  );
}
async function replaceCrendentials(profileName, accessKeyId, accessKeySecret, env) {
  const credentialsPath = `${os.homedir}/.aws/credentials`;
  const credentialsFile = await fs.readFile(credentialsPath, "utf8");
  const newDefaultProfile = `[${profileName}]
aws_access_key_id=${accessKeyId}
aws_secret_access_key=${accessKeySecret}`;
  const re = new RegExp(`^\\[${profileName}\\]\\s*.+\\s*.+$`, "m");
  const newFile = credentialsFile.replace(re, newDefaultProfile);
  await fs.writeFile(credentialsPath, newFile);
  if (typeof env === "string") {
    const envFilePath = path.resolve(env);
    try {
      let envFile = await fs.readFile(envFilePath, "utf-8");
      envFile = envFile.replace(
        /^AWS_ACCESS_KEY_ID=.*$/m,
        `AWS_ACCESS_KEY_ID=${accessKeyId}`
      );
      envFile = envFile.replace(
        /^AWS_SECRET_ACCESS_KEY=.*$/m,
        `AWS_SECRET_ACCESS_KEY=${accessKeySecret}`
      );
      await fs.writeFile(envFilePath, envFile);
    } catch (err) {
      prompts.log.error(`Failed updating env file: ${envFilePath}
${err}`);
    }
  }
}
async function getAllCredentialProfiles() {
  const credentialsPath = `${os.homedir}/.aws/credentials`;
  const credentialsFile = await fs.readFile(credentialsPath, "utf8");
  const matches = credentialsFile.match(/^\[.*\]$/gm);
  if (!matches)
    return [];
  return matches.map((profile) => profile.slice(1, -1));
}
async function getAllProfiles(profiles) {
  const p = profiles.map(async (profile) => {
    const getProfile = credentialProviders.fromIni({ profile });
    const prof = await getProfile();
    return {
      name: profile,
      ...prof
    };
  });
  const [accessKeys, ...allProfiles] = await Promise.all([
    listAccessKeys(),
    ...p
  ]);
  return allProfiles.map((profile) => {
    const foundKey = accessKeys?.find(
      (key) => key.AccessKeyId === profile.accessKeyId
    );
    return { ...profile, createDate: foundKey?.CreateDate };
  }).filter((key) => !!key.createDate);
}
async function run() {
  const args = argv(process.argv.slice(2), {
    alias: {
      profiles: ["p"],
      output: ["o"],
      env: ["e"]
    },
    boolean: ["profiles", "output"]
  });
  if (args.env === true) {
    args.env = ".env";
  }
  console.log();
  prompts.intro(color.inverse(" rotate-aws-key "));
  let profiles = ["default"];
  if (args.profiles) {
    try {
      profiles = await getAllCredentialProfiles();
    } catch (err) {
      prompts.log.error(err);
      process.exit(1);
    }
  }
  const allProfiles = await getAllProfiles(profiles);
  if (!allProfiles.length) {
    prompts.cancel("No existing access keys");
    return process.exit(0);
  }
  let selectedProfiles = ["default"];
  if (args.profiles) {
    selectedProfiles = await prompts.multiselect({
      message: "Which profiles would you like to rotate?",
      options: allProfiles.map((profile) => ({
        value: profile.name,
        label: `${profile.name} ${color.dim(
          `${profile.accessKeyId} (${dateFns.differenceInCalendarDays(
             new Date(),
            new Date(profile.createDate)
          )}d)`
        )}`
      }))
    });
    if (prompts.isCancel(selectedProfiles)) {
      prompts.cancel("Operation cancelled");
      return process.exit(0);
    }
  }
  const selectedForRotation = allProfiles.filter(
    (profile) => selectedProfiles.includes(profile.name)
  );
  if (selectedForRotation.length > 2) {
    return prompts.log.error("Cannot rotate more than 2 access keys");
  }
  if (!selectedForRotation.length) {
    return prompts.outro("Nothing to rotate");
  }
  const plural = selectedForRotation.length > 1;
  const s = prompts.spinner();
  s.start(`Rotating access key${plural ? "s" : ""}`);
  const rotated = [];
  for (const profile of selectedForRotation) {
    const [accessKeyId, accessKeySecret] = await createAccessKey();
    try {
      await replaceCrendentials(
        profile.name,
        accessKeyId,
        accessKeySecret,
        selectedForRotation.length === 1 ? args.env : false
      );
    } catch (err) {
      prompts.log.error(`Failed replacing credentials
${err}`);
    }
    rotated.push({
      name: profile.name,
      key: accessKeyId,
      secret: accessKeySecret
    });
  }
  s.stop(`Rotated ${selectedForRotation.length} access key${plural ? "s" : ""}`);
  const del = selectedForRotation.map((profile) => {
    return deleteKey(profile.accessKeyId);
  });
  await Promise.all(del);
  if (args.output) {
    rotated.forEach((k) => {
      prompts.note(
        `AWS_ACCESS_KEY_ID=${k.key}
AWS_SECRET_ACCESS_KEY=${k.secret}`,
        k.name
      );
    });
  }
  prompts.outro("Complete");
}
run();
