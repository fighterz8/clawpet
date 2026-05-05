# Windows Signing

This document covers the practical path from stable Windows downloads to lower-friction Windows installs.

## What stable links solve

Using GitHub Releases gives Clawpet:
- stable download URLs
- versioned installers
- a normal release page instead of ephemeral Actions artifacts

This improves distribution, but it does **not** fully remove Windows security prompts by itself.

## What actually reduces Windows warnings

Windows trust improves when the installer is **code-signed**.

For Clawpet, the immediate target is signing:
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*.exe`

## Current workflow support

The desktop build workflow now supports optional Windows signing when these GitHub Actions secrets are present:

- `WINDOWS_SIGN_CERT_BASE64`
  - Base64-encoded `.pfx` certificate file
- `WINDOWS_SIGN_CERT_PASSWORD`
  - Password for that `.pfx`
- `WINDOWS_SIGN_TIMESTAMP_URL` *(optional)*
  - RFC3161 timestamp server URL
  - default fallback: `http://timestamp.digicert.com`

If the required secrets are missing, the workflow still builds and publishes unsigned installers.

## Recommended certificate path

### Start here

Buy a standard Windows code-signing certificate from a reputable CA that can issue a `.pfx` suitable for CI-based signing.

This is the easiest path to get started.

### Later upgrade path

If SmartScreen reputation becomes a major blocker, consider:
- EV code signing, or
- a managed signing product such as Azure Trusted Signing

That is more operationally heavy, so it is not the first move unless distribution volume justifies it.

## Preparing the `.pfx` for GitHub Actions

On a trusted machine:

```bash
base64 -w 0 clawpet-codesign.pfx > clawpet-codesign.pfx.base64
```

Then store the file contents as the GitHub Actions secret:
- `WINDOWS_SIGN_CERT_BASE64`

Store the PFX password as:
- `WINDOWS_SIGN_CERT_PASSWORD`

Optional timestamp server:
- `WINDOWS_SIGN_TIMESTAMP_URL`

## Workflow behavior

On Windows builds, the workflow will:
1. build the Tauri bundles
2. materialize the PFX from `WINDOWS_SIGN_CERT_BASE64`
3. sign the MSI and EXE using `signtool`
4. upload signed artifacts
5. publish signed assets to GitHub Releases on tagged builds

## Current limitations

- This does not magically guarantee zero SmartScreen friction on day one.
- Reputation still takes time, especially for standard code-signing certs.
- Stable links + code signing is the correct foundation; reputation improves from there.

## Future improvements

- add SHA256 checksum publishing to releases
- add signer verification step after signing
- evaluate direct/latest asset links instead of only `/releases/latest`
- evaluate managed signing if local PFX handling becomes a maintenance/security burden
