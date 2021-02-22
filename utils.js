const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const style = require('ansi-styles');

// track warnings
exports.warnings = 0;

exports.mainDir = 'project-main';   // otherwise project-username
exports.testDir = 'project-tests';  // must match pom.xml and repository name

/*
 * Checks the exit code after executing a command and throws
 * an error if it is non-zero. Useful since exec.exec triggers
 * failure on non-zero exit codes by default.
 *
 * command: the command to exec
 * settings.param: the parameters to use (array)
 * settings.title: the title to output before executing
 * settings.error: the error message to use for non-zero exit code
 *                 (if not specified, no error is thrown)
 * settings.chdir: working directory to use
 */
exports.checkExec = async function(command, settings) {
  const options = {ignoreReturnCode: true};

  if ('chdir' in settings) {
    options.cwd = settings.chdir;
  }

  const param = 'param' in settings ? settings.param : [];

  if ('title' in settings) {
    core.info(`\n${settings.title}...`);
  }

  const result = await exec.exec(command, param, options);

  if ('error' in settings && result !== 0) {
    throw new Error(`${settings.error} (${result}).`);
  }

  return result;
}

exports.saveStates = function(states) {
  core.startGroup('Saving state...');
  core.info('');

  for (const state in states) {
    core.saveState(state, states[state]);
    core.info(`Saved value ${states[state]} for state ${state}.`);
  }

  core.saveState('keys', JSON.stringify(Object.keys(states)));

  core.info('');
  core.endGroup();
}

exports.restoreStates = function(states) {
  core.startGroup('Restoring state...');
  core.info('');

  const keys = JSON.parse(core.getState('keys'));
  core.info(`Loaded keys: ${keys}`);

  for (const key of keys) {
    states[key] = core.getState(key);
    core.info(`Restored value ${states[key]} for state ${key}.`);
  }

  core.info('');
  core.endGroup();
  return states;
}

exports.parseProject = function(context, ref) {
  core.startGroup('Parsing project details...');
  core.info('');

  const details = {};

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  details.owner    = owner;
  details.mainRepo = `${owner}/${repo}`;
  details.testRepo = `${owner}/${exports.testDir}`;

  const tokens = ref.split('/');
  const version = tokens[tokens.length - 1];

  const regex = /^v([1-4])\.(\d+)\.(\d+)$/;
  const matched = version.match(regex);

  if (matched !== null && matched.length === 4) {
    details.project = +matched[1];
    details.reviews = +matched[2];
    details.patches = +matched[3];
    details.version = version;
  }
  else {
    throw new Error(`Unable to parse project information from: ${ref}`);
  }

  core.info(`Project version: ${details.version}`);
  core.info(`Project number:  ${details.project}`);
  core.info(`Project reviews: ${details.reviews}`);
  core.info(`Project patches: ${details.patches}`);

  core.info('');
  core.endGroup();

  return details;
}

exports.verifyRelease = async function(octokit, context, release) {
  core.startGroup('Checking release details...');
  core.info('');

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const details = {};

  try {
    // https://docs.github.com/en/rest/reference/repos#get-a-release-by-tag-name
    core.info(`Fetching release ${release} from ${repo}...`);
    const result = await octokit.repos.getReleaseByTag({
      owner: owner, repo: repo, tag: release
    });

    core.info(JSON.stringify(result));

    if (result.status != 200) {
      throw new Error(`${result.status} exit code`);
    }

    details.release = result;
  }
  catch (error) {
    // produce better error output
    throw new Error(`Unable to fetch release ${release} (${error.message.toLowerCase()}).`);
  }

  core.info('');

  try {
    // https://docs.github.com/en/rest/reference/actions#list-workflow-runs-for-a-repository
    core.info('Getting workflow runs...');
    const result = await octokit.actions.listWorkflowRuns({
      owner: owner,
      repo: repo,
      workflow_id: 'run-tests.yml',
      event: 'release'
    });

    if (result.status != 200) {
      core.info(JSON.stringify(result));
      throw new Error(`${result.status} exit code`);
    }

    const branches = result.data.workflow_runs.map(r => r.head_branch);
    core.info(`Fetched ${result.data.workflow_runs.length} workflow runs: ${branches.join(', ')}`);

    const found = runs.data.workflow_runs.find(r => r.head_branch === release);

    if (found === undefined) {
      throw new Error(`workflow run not found`);
    }

    core.info(JSON.stringify(found));

    if (found.status != "completed" && found.conclusion != "success") {
      throw new Error(`run #${found.run_number} (${found.id}) not successful`);
    }

    details.workflow = found;
  }
  catch (error) {
    throw new Error(`Unable to verify release ${release} (${error.message.toLowerCase()}).`);
  }

  return details;
}

exports.showTitle = function(text) {
  core.info(`\n${style.cyan.open}${style.bold.open}${text}${style.bold.close}${style.cyan.close}`);
}

function styleText(color, bgColor, label, text) {
  core.info(`${style[bgColor].open}${style.black.open}${style.bold.open}${label}:${style.bold.close}${style.black.close}${style[bgColor].close} ${style[color].open}${text}${style[color].close}`);
}

function incrementWarnings() {
  const past = core.getState('warnings');
  console.info(`was ${past}`);
  const next = past ? parseInt(past) + 1 : 1;
  console.info(`now ${next}`);
  core.saveState('warnings', next);
}

exports.showError = function(text) {
  styleText('red', 'bgRed', 'Error', text);
}

exports.showSuccess = function(text) {
  styleText('green', 'bgGreen', 'Success', text);
}

exports.showWarning = function(text) {
  exports.warnings++;
  styleText('yellow', 'bgYellow', 'Warning', text);
}

exports.checkWarnings = function(phase) {
  if (exports.warnings > 1) {
    core.warning(`There were ${exports.warnings} warnings in the ${phase} phase. View the run log for details.`);
  }
  else if (exports.warnings == 1) {
    core.warning(`There was ${exports.warnings} warning in the ${phase} phase. View the run log for details.`);
  }
}