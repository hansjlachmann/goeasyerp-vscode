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

  confirmRemove: (project: string) => `Remove the container ${project}?`,
  confirmRemoveDetail: 'This deletes its database. It cannot be undone.',
  remove: 'Remove',
} as const;
