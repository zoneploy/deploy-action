const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const input = (name, fallback = "") => {
  const key = `INPUT_${name.replace(/ /g, "_").replace(/-/g, "_").toUpperCase()}`;
  const value = process.env[key];
  return value && value.trim() ? value.trim() : fallback;
};

const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

const output = (name, value) => {
  if (!process.env.GITHUB_OUTPUT || value === undefined || value === null) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
};

const mask = (value) => {
  if (value) console.log(`::add-mask::${value}`);
};

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

const relativePath = (value, label) => {
  const resolved = path.resolve(workspace, value || ".");
  const relative = path.relative(workspace, resolved) || ".";

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} must be inside GITHUB_WORKSPACE.`);
  }

  return relative.split(path.sep).join("/");
};

const requestJson = async (url, token, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "zoneploy-action",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `Request failed with HTTP ${response.status}`;
    fail(message);
  }

  return data;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`);
  }
};

const detectTarget = (target, composeFile, dockerfile, image) => {
  if (target !== "auto") return target;
  if (image) return "container";
  if (fs.existsSync(path.resolve(workspace, composeFile))) return "stack";
  if (fs.existsSync(path.resolve(workspace, dockerfile))) return "container";
  fail("Could not auto-detect deploy target. Add a Dockerfile, docker-compose.yml, or set target.");
};

const defaultRepository = () => {
  if (!process.env.GITHUB_REPOSITORY) return "";
  return `https://github.com/${process.env.GITHUB_REPOSITORY}.git`;
};

const buildGitPayload = ({ repository, ref, commitSha, githubToken, contextPath, dockerfile, composeFile }) => ({
  repository,
  ref,
  commitSha,
  contextPath,
  dockerfile,
  composeFile,
  ...(githubToken ? { token: githubToken } : {}),
});

const dockerLogin = (registry) => {
  if (!registry?.url || !registry.username || !registry.password) {
    fail("Zoneploy selected push-to-user-registry but did not return registry credentials.");
  }

  mask(registry.password);
  const host = registry.url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const result = spawnSync("docker", ["login", host, "-u", registry.username, "--password-stdin"], {
    input: registry.password,
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (result.status !== 0) {
    fail(`Docker login failed for ${host}.`);
  }
};

const pushContainerImage = (plan, dockerfile, contextPath) => {
  if (!plan.image) fail("Zoneploy did not return an image target.");
  run("docker", ["build", "-f", dockerfile, "-t", plan.image, contextPath], { cwd: workspace });
  run("docker", ["push", plan.image], { cwd: workspace });
};

const main = async () => {
  const apiUrl = input("api-url").replace(/\/+$/, "");
  const deployToken = input("deploy-token") || input("token");
  const explicitTarget = input("target", "auto").toLowerCase();
  const image = input("image");
  const composeFile = relativePath(input("compose-file", "docker-compose.yml"), "compose-file");
  const dockerfile = relativePath(input("dockerfile", "Dockerfile"), "dockerfile");
  const contextPath = relativePath(input("context", "."), "context");
  const repository = input("repository", defaultRepository());
  const ref = input("ref", process.env.GITHUB_REF_NAME || "");
  const commitSha = input("commit-sha", process.env.GITHUB_SHA || "");
  const githubToken = input("github-token");

  if (!apiUrl) fail("api-url is required.");
  if (!deployToken) fail("deploy-token is required.");
  mask(deployToken);
  mask(githubToken);
  if (!["auto", "container", "stack"].includes(explicitTarget)) {
    fail("target must be auto, container or stack.");
  }

  const target = detectTarget(explicitTarget, composeFile, dockerfile, image);
  if (target === "container" && !image && !repository) {
    fail("repository is required for container builds.");
  }
  if (target === "stack" && !repository) {
    fail("repository is required for stack builds.");
  }

  const plan = await requestJson(`${apiUrl}/deploy/plan`, deployToken, {
    target,
    image: image || undefined,
  });

  output("deploy-id", plan.deployId);
  output("mode", plan.mode);

  let deployPayload;
  if (plan.mode === "external-image") {
    deployPayload = {
      deployId: plan.deployId,
      releaseId: plan.deployId,
      image: image || plan.image,
    };
  } else if (plan.mode === "push-to-user-registry") {
    if (target !== "container") {
      fail("push-to-user-registry for stacks is not enabled yet. Use remote-build for stacks.");
    }

    dockerLogin(plan.registry);
    pushContainerImage(plan, dockerfile, contextPath);
    deployPayload = {
      deployId: plan.deployId,
      releaseId: plan.deployId,
      image: plan.image,
    };
  } else if (plan.mode === "remote-build") {
    const git = buildGitPayload({
      repository,
      ref,
      commitSha,
      githubToken,
      contextPath,
      dockerfile,
      composeFile,
    });

    deployPayload = {
      deployId: plan.deployId,
      releaseId: plan.deployId,
      git,
    };

    if (target === "stack") {
      const composePath = path.resolve(workspace, composeFile);
      if (!fs.existsSync(composePath)) fail(`Compose file not found: ${composeFile}`);
      deployPayload.composeFile = fs.readFileSync(composePath).toString("base64");
    }
  } else {
    fail(`Unsupported Zoneploy deploy mode: ${plan.mode}`);
  }

  const result = await requestJson(`${apiUrl}/deploy`, deployToken, deployPayload);
  output("deployment-id", result.deploymentId);
  output("status", result.status);
  console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Zoneploy deploy failed.");
});
