<p align="center">
  <a href="https://npmjs.com/package/rotate-aws-key"><img src="https://img.shields.io/npm/v/rotate-aws-key.svg" alt="npm package"></a>
  <a href="https://nodejs.org/en/about/releases/"><img src="https://img.shields.io/npm/dm/rotate-aws-key" alt="npm downloads"></a>
</p>

# rotate-aws-key 🔄

> Rotate AWS access keys.

- Create new and delete old AWS access keys.
- Replaces the key in the AWS credentials file.
- Optionally replace the key in a env file.

### Usage

```
npx rotate-aws-key
```

By default, `rotate-aws-key` attempts to rotate the `default` profile access key in the AWS credentials file normally found at `~/.aws/credentials`.

### Options

| Flags          | Description                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| -o, --output   | Print the new access keys generated in the console                                                                       |
| -p, --profiles | Allows choosing up to 2 profiles in the credentials file to rotate                                                       |
| -e, --env      | Replaces access key environment variables in a provided file defaulting to `./.env`. Only if 1 profile is being rotated. |
