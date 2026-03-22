# Feishin AI Context Files

This directory contains context files to help AI coding agents understand and contribute to Feishin effectively.

## Files

### `copilot-instructions.md`
**Purpose**: Technical architecture and development guidelines
**Content**:
- Architecture overview (Electron + React + Vite)
- Data flow and state management (Zustand, TanStack Query)
- Critical developer workflows (build, test, lint commands)
- Project conventions (path aliases, component patterns, i18n)
- Integration points (music servers, Electron APIs, MPV player)

### `copilot-vision.md`
**Purpose**: Product vision and design goals
**Content**:
- Core philosophy and design principles
- Target user experience and success metrics
- Visual design guidelines
- Future roadmap and development priorities

## Usage Guidelines

- **Technical Changes**: Reference `copilot-instructions.md` for architecture patterns and conventions
- **UI/UX Changes**: Reference `copilot-vision.md` for design principles and user experience goals
- **New Features**: Consult both files to ensure alignment with technical architecture and product vision
- **Code Reviews**: Use these files as checklists for consistency and quality

## Contributing

When adding new context files:
1. Use `copilot-*.md` naming pattern
2. Include clear purpose and content summary
3. Update this index file
4. Reference specific files/examples where possible