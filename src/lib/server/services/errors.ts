import "server-only";

export class IntegrationUnavailableError extends Error {
  readonly code = "INTEGRATION_UNAVAILABLE";

  constructor(provider: "OpenAI" | "Agnic", capability: string) {
    super(`${provider} ${capability} is not implemented in Milestone 1.`);
    this.name = "IntegrationUnavailableError";
  }
}
