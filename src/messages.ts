/**
 * The texts users see at runtime, in one place so they can be translated later.
 * The texts of package.json are in package.nls.json.
 */
export const messages = {
  outputChannelName: 'GoEasyERP',
  showOutput: 'Show Output',

  dockerMissing: 'Docker is required and is not installed.',
  dockerUnreachable:
    'Docker is installed but cannot be reached. Start Docker, and check that your user may use it.',
  dockerNoCompose: 'Docker Compose is required and is not installed.',
  installDocker: 'Install Docker',

  busy: 'Another container operation is running. Wait until it has finished.',
  failed: (reason: string) => `GoEasyERP: ${reason}`,

  loadingVersions: 'Looking up the base versions',
  versionsUnavailable: (reason: string) =>
    `The list of base versions is not available (${reason}). Enter the version.`,
  noVersions: 'No base release with the development endpoint was found.',
  pickVersion: 'Base version of the new container',
  newest: 'newest',
  enterVersion: (minimum: string) => `Base version, ${minimum} or newer`,
  badVersion: (minimum: string) => `Enter a version such as ${minimum}, ${minimum} or newer.`,
  enterPort: 'Port of the new container on this computer',
  badPort: 'Enter a port from 1024 to 65535.',
  portBusy: (port: number) => `Port ${port} is in use. Choose another.`,
  enterPassword: (user: string) => `Password for the user ${user} of the new container`,
  repeatPassword: 'Repeat the password',
  passwordsDiffer: 'The passwords are not the same.',
  passwordTooShort: (length: number) => `The password needs at least ${length} characters.`,
  passwordHasUserId: (user: string) => `The password must not contain the user ID ${user}.`,
  userExists: (project: string) =>
    `${project} has a user already. The password you entered was not used.`,
  passwordRefused: (reason: string) => `The server refused the password: ${reason}`,

  creating: (project: string) => `Creating ${project}`,
  starting: (project: string) => `Starting ${project}`,
  stopping: (project: string) => `Stopping ${project}`,
  removing: (project: string) => `Removing ${project}`,
  downloadingFiles: 'Downloading the compose files',
  startingContainer: 'Starting (a first start takes a few minutes)',
  creatingUser: 'Making the first user',

  created: (project: string, server: string, user: string) =>
    `${project} is running at ${server}. Log in as ${user}.`,
  started: (project: string, server: string) => `${project} is running at ${server}.`,
  stopped: (project: string) => `${project} is stopped.`,
  removed: (project: string) => `${project} is removed.`,
  incomplete: (project: string) =>
    `${project} is not ready. Run "Start Local Container" to try again, or "Remove Local Container".`,
  cancelled: (project: string) => `Cancelled. ${project} is not ready.`,

  noContainers: 'There is no local container yet. Run "Create Local Container".',
  pickContainer: (action: string) => `Local container to ${action}`,
  actionStart: 'start',
  actionStop: 'stop',
  actionRemove: 'remove',
  containerDetail: (version: string, server: string) => `base ${version}, ${server}`,
  state: { running: 'running', stopped: 'stopped', absent: 'not running' },

  required: 'Enter a value.',
  appName: 'Name of the new app',
  appPublisher: "The app's publisher",
  appContact: 'A web address or e-mail address to reach the publisher',
  appPrefix: "Prefix of the app's own names",
  badPrefix: '2 to 10 lower case letters and digits, starting with a letter.',
  appParent: (folder: string) => `Folder to create "${folder}" in`,
  appParentButton: 'Create Here',
  folderNotEmpty: (folder: string) => `The folder ${folder} is not empty.`,
  appCreated: (folder: string, from: number, to: number) =>
    `The app is in ${folder}, with the numbers ${from} to ${to}.`,
  openFolder: 'Open',
  openNewWindow: 'Open in New Window',

  noApp: 'No GoEasyERP app is open: no application.yaml that depends on the base application.',
  offerDownload: 'Download the base for code completion in this GoEasyERP app?',
  downloadBase: 'Download Base',
  preparingBase: (version: string) => `Base ${version}`,
  baseReady: (version: string) => `The base ${version} with the app is ready.`,
  step: {
    source: 'Downloading the base',
    go: 'Preparing Go',
    copy: 'Copying the base',
    merge: 'Merging the app',
    generate: 'Generating the table code',
  },
  pickBaseVersion: 'Base version the app is built against',
  serverUnreachable: (server: string) => `${server} does not answer.`,
  serverTooOld: (server: string, version: string, minimum: string) =>
    `${server} runs ${version}; ${minimum} or newer is needed.`,
  appErrors: 'The app could not be merged into the base. See the Problems panel.',
  terminalPath: (version: string) =>
    `Adds Go ${version}, which the base is built with, to the PATH.`,

  compileTask: 'Compile',
  auditing: 'App audit',
  refused: 'REFUSED',
  approved: 'approved',
  packaged: (path: string) => `Package: ${path}`,
  compiled: 'The app compiled. Nothing was published.',
  compileFailed: 'The app has errors. See the Problems panel.',
  packageWritten: (path: string) => `The package is in ${path}.`,
  reveal: 'Show in File Manager',

  badSetting: (name: string) => `The launch configuration's "${name}" cannot be used.`,
  noRecreate:
    'schemaUpdateMode "recreate" is not available yet. Use "synchronize", which adds new tables and fields.',
  connecting: (server: string) => `Connecting to ${server}`,
  loginPassword: (user: string, server: string) => `Password of ${user} on ${server}`,
  compiling: 'Compiling',
  uploading: 'Publishing',
  building: (step: string) => `Building… ${step}`,
  switching: 'Waiting for the server to run the build',
  buildFailed: (no: number, status: string, reason: string) =>
    `Build ${no} ${status.toLowerCase()}${reason ? `: ${reason}` : '.'}`,
  notLive: 'The build succeeded, but the server did not start to run it.',
  notDevelopmentServer:
    'This is not a development server: it takes no apps from VS Code. Use a local container, or install the app as a package.',
  published: (no: number, server: string) => `Build ${no} is live on ${server}.`,
  publishStopped: 'Stopped waiting. A build the server has started still runs.',
  publishBusy: 'A publish is running. Wait until it has finished.',
  unpublish: 'Unpublish',
  confirmUnpublish: (app: string, server: string) => `Unpublish ${app} from ${server}?`,
  unpublished: (app: string, no: number) => `${app} is unpublished (build ${no}).`,
  noAppId: 'application.yaml has no id.',
  pickConfiguration: 'Server to unpublish from',
  openBrowser: 'Open in Browser',

  confirmRemove: (project: string) => `Remove the container ${project}?`,
  confirmRemoveDetail: 'This deletes its database. It cannot be undone.',
  remove: 'Remove',
} as const;
