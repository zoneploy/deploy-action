# Zoneploy Action

Deploy containers and Docker Compose stacks to Zoneploy without sending user images
through a central Zoneploy registry.

## Usage

```yaml
name: Deploy to Zoneploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: zoneploy/zoneploy-action@v1
        with:
          deploy-token: ${{ secrets.ZP_DEPLOY_TOKEN }}
          github-token: ${{ github.token }}
```

For development:

```yaml
- uses: zoneploy/zoneploy-action@development
  with:
    api-url: https://api.dev.zoneploy.com/api/v1
    deploy-token: ${{ secrets.ZP_DEPLOY_TOKEN }}
    github-token: ${{ github.token }}
```

## How it works

The action asks Zoneploy Cloud for a deploy plan. Zoneploy decides where the
image should go based on the server connected to the project.

- `remote-build`: the self-hosted VPS clones the repository, builds the image,
  pushes it to its local registry and deploys it.
- `push-to-user-registry`: the action builds in GitHub Actions and pushes to a
  user-owned registry returned by Zoneploy.
- `external-image`: the action deploys an existing image without building.

Zoneploy Cloud never stores or serves user image layers.

## Inputs

| Input | Required | Default | Description |
|---|---:|---|---|
| `deploy-token` | Yes |  | Zoneploy deploy token. |
| `token` | No |  | Legacy alias for `deploy-token`. |
| `api-url` | No | `https://api.zoneploy.com/api/v1` | Zoneploy API base URL. |
| `target` | No | `auto` | `auto`, `container` or `stack`. |
| `github-token` | No |  | Token used by the VPS for private repository clone. |
| `repository` | No | Current GitHub repo | Git URL cloned by the VPS. |
| `ref` | No | Current ref | Branch or tag cloned by the VPS. |
| `commit-sha` | No | Current SHA | Commit checked out after clone. |
| `context` | No | `.` | Container build context inside the repo. |
| `dockerfile` | No | `Dockerfile` | Dockerfile path relative to `context`. |
| `compose-file` | No | `docker-compose.yml` | Compose file path for stack deploys. |
| `image` | No |  | Existing external image to deploy. |

## Examples

Container with a custom Dockerfile:

```yaml
- uses: zoneploy/zoneploy-action@v1
  with:
    deploy-token: ${{ secrets.ZP_DEPLOY_TOKEN }}
    github-token: ${{ github.token }}
    context: .
    dockerfile: docker/Dockerfile.prod
```

Stack:

```yaml
- uses: zoneploy/zoneploy-action@v1
  with:
    deploy-token: ${{ secrets.ZP_DEPLOY_TOKEN }}
    github-token: ${{ github.token }}
    target: stack
    compose-file: infra/docker-compose.yml
```

Existing image:

```yaml
- uses: zoneploy/zoneploy-action@v1
  with:
    deploy-token: ${{ secrets.ZP_DEPLOY_TOKEN }}
    image: ghcr.io/example/app:${{ github.sha }}
```

## License

Apache-2.0
