# GitHub Workflows

This directory contains automated workflows for the homebridge-bond project.

## Workflows

### 1. Build and Lint (`build.yml`)
- **Trigger:** On every push and pull request
- **Purpose:** Validates code quality and ensures the project builds successfully
- **Actions:**
  - Runs linting
  - Builds the project
  - Runs tests
  - Tests across multiple Node.js versions (18.x, 20.x, 22.x)

### 2. Version Bump (`version-bump.yml`)
- **Trigger:** Manual (workflow_dispatch)
- **Purpose:** Creates a pull request with a version bump
- **How to use:**
  1. Go to the "Actions" tab in GitHub
  2. Select "Version Bump" workflow
  3. Click "Run workflow"
  4. Choose version bump type (patch/minor/major/prerelease) or enter a custom version
  5. Click "Run workflow"
- **What it does:**
  - Updates the version in `package.json`
  - Creates a new branch
  - Opens a pull request with the version change
  - Labels the PR appropriately

### 3. Release (`release.yml`)

The scoped package is released from the fork's `matter` branch. Bump both
`package.json` and `package-lock.json`, then push the matching `v<version>` tag
from that commit.

```bash
npm version <version> --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release Bond <version>"
git push origin HEAD:matter
git tag -a v<version> -m "Release Bond <version>"
git push origin refs/tags/v<version>
```

GitHub Actions uses Node 24 to lint, build and run the tests, then packs,
inspects and tests the installable tarball. After publishing the same tarball,
the workflow checks its integrity and dist-tag in the public npm registry and
creates a GitHub release. Prereleases such as `3.3.2-beta.3` go to `beta`.
Stable versions go to `latest`.

To run the build and tarball checks without publishing, select the `matter`
branch when running **Release** manually in GitHub Actions.

#### npm Trusted Publishing

On the [scoped package's npm settings](https://www.npmjs.com/package/@linanw/homebridge-bond/access),
set the trusted publisher to **GitHub Actions**:

- Repository owner: `linanw`
- Repository: `homebridge-bond`
- Workflow filename: `release.yml`
- Environment: leave blank
- Allowed action: direct publish

Use a new release tag to validate the first publish within two days of setup.
The publish job obtains its credentials from GitHub OIDC and uses no stored
npm token. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).
