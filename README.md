---
meta:
  contentType: Landing
---

# Design and make Hack Night badges

Preview your badge in acrylic, check your files, and prepare cutting sheets. This repository owns the badge workflow, materials, renderer, inventory, and publishing service. [Wack Hacker](https://github.com/purduehackers/wack-hacker) supplies Discord messages, controls, and the conversational agent.

Use these pages to understand or run the project:

- **Workflow**: [Understand the designer and manufacturer steps](docs/workflow.md)
- **Service setup**: [Configure the badge service](docs/service.md)
- **Saved assets**: [Download published badge designs](https://github.com/purduehackers/badge-designs)

The Next.js app previews local Scalable Vector Graphics (SVG) files. The service renders Discord images with the same Three.js scene and material definitions. Both previews show nominal geometry; neither predicts laser kerf or proves that fine details will survive manufacturing.
