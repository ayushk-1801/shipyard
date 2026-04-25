import type { Deployment } from "./types.js";

const matcherName = (slug: string) => `host_${slug.replace(/-/gu, "_")}`;

export const renderCaddyfile = (deployments: Deployment[]) => {
  const running = deployments.filter(
    (deployment) =>
      deployment.status === "running" && deployment.containerName && deployment.containerPort
  );

  const hostRoutes = running
    .map(
      (deployment) => `
	@${matcherName(deployment.slug)} host ${deployment.slug}.localhost
	handle @${matcherName(deployment.slug)} {
		reverse_proxy ${deployment.containerName}:${deployment.containerPort}
	}
`
    )
    .join("");

  const pathRoutes = running
    .map(
      (deployment) => `
	handle /d/${deployment.slug} {
		redir /d/${deployment.slug}/ 308
	}

	handle_path /d/${deployment.slug}/* {
		reverse_proxy ${deployment.containerName}:${deployment.containerPort}
	}
`
    )
    .join("");

  return `{
	admin 0.0.0.0:2019
	auto_https off
}

:80 {
${hostRoutes}
	handle /api/* {
		reverse_proxy backend:3001 {
			flush_interval -1
		}
	}
${pathRoutes}
	handle /d/* {
		respond "Deployment route is not ready yet." 404
	}

	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}
`;
};

export class CaddyClient {
  constructor(private readonly adminUrl: string) {}

  async load(caddyfile: string) {
    const response = await fetch(`${this.adminUrl}/load`, {
      method: "POST",
      headers: {
        "Content-Type": "text/caddyfile"
      },
      body: caddyfile
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Caddy reload failed (${response.status}): ${body}`);
    }
  }
}
