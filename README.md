# inksprite

inksprite is a writing app that runs locally in your browser or as a standalone
desktop application. You do not need to make an account to use inksprite. Your
work stays on your device.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/src/assets/guide/first-chat-dark.png">
  <img alt="A project's outline, a document of ideas, and the chat in which the AI read Chapter 1 and wrote them" src="docs/src/assets/guide/first-chat.png">
</picture>

**[Open it in your browser](https://app.inksprite.io)** ·
[Download the desktop app](https://github.com/inksprite-io/inksprite/releases/latest) ·
[Getting Started guide](https://docs.inksprite.io/getting-started)

## AI tools

You can use the built-in AI tools to:

- Write and edit documents
- Research and brainstorm
- Generate audio narrations

They work with OpenRouter, Anthropic, OpenAI, or a model on your own machine.
Requests go straight from your device to the provider.

inksprite is still in development. Please report bugs and issues
[here](https://github.com/inksprite-io/inksprite/issues).

## Running it

```bash
cd app
npm install
npm run dev
```

`npm run build` writes a static site to `app/dist/`. A build sends no
analytics unless it is built with `VITE_VERCEL_ANALYTICS=true`.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the sign-off rule, and the
terms a contribution comes in under: you keep your copyright and license it
under Apache-2.0, and the project releases the whole under the AGPL. Read that
section before your first pull request.

## License

inksprite is free software under the
[GNU Affero General Public License, version 3 or later](LICENSE).
Copyright © 2025–2026 The inksprite Authors.

### Icons

The icons are from the [Noun Project](https://thenounproject.com), each
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) by its
creator, and are not covered by the AGPL. [CREDITS.md](CREDITS.md) lists
them, and the app credits them under Settings › About.

### The name and the logo

The inksprite name and the logo are not covered by the license; all rights to
them are reserved.
