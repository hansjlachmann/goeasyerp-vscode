# GoEasyERP

[GoEasyERP](https://github.com/hansjlachmann/goeasyerp) is a free, open-source Business
Application, an ERP system for small businesses: finance, sales, purchasing, inventory, projects
and fixed assets in one system. It runs in containers, on Docker or Kubernetes, has minimal
hardware requirements, and is published under the MIT open-source licence.

## The extension

Write a GoEasyERP **extension app** in VS Code, compile it with **Ctrl+Shift+B**, and publish it
with **F5** to GoEasyERP running in a local Docker container. The new code is live in the browser
seconds later.

An extension app adds to GoEasyERP without changing it: new tables and pages, fields on the base
application's tables, fields, columns and buttons on its pages, entries in the main menu, texts,
and business logic written in Go.

## Requirements

- Visual Studio Code 1.136 or newer.
- Docker: Docker Desktop on Windows and macOS, Docker Engine with Compose on Linux. So far the
  extension is tested on Linux only.
- On Windows: Docker Desktop with **WSL 2**, running Linux containers.
- GoEasyERP 0.1.194 or newer, running as a development server. **Create Local Container** sets
  one up.

You do not need to install Go. The extension provides the version the base application uses,
without administrator rights and without changing a Go installation you already have.

The [Go](https://marketplace.visualstudio.com/items?itemName=golang.go) and
[YAML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) extensions are
installed together with this one.

## Getting started

1. Run **GoEasyERP: Create Local Container**. The first start takes a few minutes.
2. Run **GoEasyERP: New App** and open the app's folder.
3. Add a field to the Customer table and show it on the Customer Card.
4. Press **F5**. The browser opens, and the field is on the Customer Card.

The first publish takes a few minutes, while the extension downloads Go and the base
application. After that, a change of the app's code is typically live in about half a minute.

In the app's folder the extension keeps its downloads in `.goeasyerp/`, writes `go.work`, and,
when it provides Go, sets `go.goroot` in the workspace settings. A new app's `.gitignore` leaves
all three out of your repository.

## Commands and keys

| Command or key | Does |
|---|---|
| **Create Local Container** | Sets up GoEasyERP in Docker on your computer and makes its first user. Start, stop and remove it with the matching commands. |
| **New App** | Writes a new app with its identity, number series and VS Code settings. |
| **Download Base** | Fetches the base application's source for the server's version, so code completion and go-to-definition know the base and your app's own fields. |
| **Compile** (Ctrl+Shift+B) | Builds and checks the app on your computer and writes its package. Errors appear in the Problems panel. Publishes nothing. |
| **Publish** (F5) | Compiles, publishes to the server of the selected launch configuration, shows the build log and opens the browser. |
| **Publish without opening** (Ctrl+F5) | The same, without the browser. |
| **Unpublish App** | Removes the app from the development server. |
| **Package App** | Writes the app's `.zip`, to upload to an installation. |
| **Next Free Object No.** / **Field No.** | Inserts the next free number of the app's number series. |
| **Open in Browser** | Opens the server's start page. |
| **Show Output** | Opens the extension's output. |

All commands start with **GoEasyERP:** in the Command Palette. The status bar shows the server of
the selected launch configuration and its state.

## Snippets

Type the start of a name in a file of your app and press **Ctrl+Space**. The snippets fill in
your app's prefix and the next free numbers.

| Snippet | In | Writes |
|---|---|---|
| `ge-table` | `custom/tables/` | A table of your own |
| `ge-tableext` | `tables/` | Fields on a base table |
| `ge-list`, `ge-card` | `custom/pages/` | A list or card page |
| `ge-pageext` | `pages/` | Fields, a section and a button on a base page |
| `ge-menu` | `menus/` | A main menu entry |
| `ge-texts` | `translations/` | Texts in one language |
| `ge-register` | Go files | The `Register` function |
| `ge-tablelogic` | Go files | A table's triggers |
| `ge-function` | Go files | A function for a page's button |
| `ge-subscribe` | Go files | Logic that runs after a sales posting |

## launch.json

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "goeasyerp",
      "request": "launch",
      "name": "Local container",
      "server": "http://localhost:8080",
      "company": "main",
      "user": "ADMIN",
      "startupPageId": 22,
      "openBrowser": true,
      "schemaUpdateMode": "synchronize"
    }
  ]
}
```

| Setting | Meaning |
|---|---|
| `server` | The address of the development server. |
| `company` | The company to log in to. |
| `user` | The user who publishes. The user needs the SUPER role. |
| `startupPageId` | The page the browser opens. |
| `openBrowser` | Whether F5 opens the browser. |
| `schemaUpdateMode` | `synchronize` adds new tables and fields. `recreate` is not available yet. |

The password is never written to this file. The extension asks for it and keeps it in the secret
storage of VS Code.

**F5 publishes to development servers only.** A production installation takes an app as a
released version, with Install App or Upload App.

## Privacy

- Your app is sent to the server of your launch configuration, and nowhere else.
- Your password goes to that server only. Use `https` for a server on another computer: over
  `http` the password and the app travel unencrypted.
- The extension downloads the base application from GitHub, its container images from the
  registries the base application names, and Go from go.dev. Go may download the modules your app
  and the base application require.
- The extension collects no telemetry. The Go and YAML extensions have their own settings.

## Licence

[MIT](LICENSE)
