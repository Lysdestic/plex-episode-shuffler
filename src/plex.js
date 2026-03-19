import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
});

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function containerItems(container) {
  return [
    ...ensureArray(container.Directory),
    ...ensureArray(container.Metadata),
    ...ensureArray(container.Video),
  ];
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function sortedResourceConnections(device) {
  const connections = ensureArray(device?.connections?.connection);
  if (connections.length === 0) return [];

  const scored = connections.map((connection) => {
    const local = toBoolean(connection.local);
    const relay = toBoolean(connection.relay);
    const https = (connection.protocol || "").toLowerCase() === "https";
    const score = (local ? 100 : 0) + (relay ? -10 : 0) + (https ? 1 : 0);
    return { connection, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.connection.uri).filter(Boolean);
}

function parseXml(text) {
  return parser.parse(text);
}

function toMediaContainer(xmlText) {
  const parsed = parseXml(xmlText);
  return parsed.MediaContainer || parsed;
}

function toErrorMessage(status, statusText, body) {
  const compactBody = (body || "").replace(/\s+/g, " ").trim();
  const tail = compactBody ? ` - ${compactBody.slice(0, 300)}` : "";
  return `HTTP ${status} ${statusText}${tail}`;
}

function isNetworkError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("eai_again") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("etimedout")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlexApi {
  constructor({ plexUrl, plexToken }) {
    this.plexUrl = plexUrl.replace(/\/$/, "");
    this.plexToken = plexToken;
    this.serverUrl = new URL(this.plexUrl);
    this.commandId = 0;
    this.clientIdentifier = createHash("sha1").update(this.plexUrl).digest("hex");
  }

  get serverProtocol() {
    return this.serverUrl.protocol.replace(":", "");
  }

  get serverAddress() {
    return this.serverUrl.hostname;
  }

  get serverPort() {
    if (this.serverUrl.port) return this.serverUrl.port;
    return this.serverProtocol === "https" ? "443" : "80";
  }

  nextCommandId() {
    this.commandId += 1;
    return this.commandId;
  }

  get defaultHeaders() {
    return {
      Accept: "application/xml",
      "X-Plex-Token": this.plexToken,
      "X-Plex-Client-Identifier": this.clientIdentifier,
      "X-Plex-Product": "random-plex-episode",
      "X-Plex-Version": "1.0.0",
      "X-Plex-Device": "Node.js",
      "X-Plex-Platform": process.platform,
      "X-Plex-Platform-Version": process.version,
      "X-Plex-Provides": "controller",
    };
  }

  async request(path, { method = "GET", headers = {}, baseUrl = this.plexUrl, token = this.plexToken } = {}) {
    const url = new URL(path, `${baseUrl}/`);
    const response = await fetch(url, {
      method,
      headers: {
        ...this.defaultHeaders,
        "X-Plex-Token": token,
        ...headers,
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(toErrorMessage(response.status, response.statusText, body));
    }
    return body;
  }

  async getServerIdentity() {
    const body = await this.request("/");
    const container = toMediaContainer(body);

    const machineIdentifier = container.machineIdentifier;
    if (!machineIdentifier) {
      throw new Error("Plex server machineIdentifier was not found in / response");
    }

    return {
      machineIdentifier,
      libraryIdentifier: "com.plexapp.plugins.library",
    };
  }

  async getClientsFromServer() {
    const body = await this.request("/clients");
    const container = toMediaContainer(body);
    const entries = ensureArray(container.Server);

    return entries
      .map((entry) => ({
        title: entry.name || entry.title || "Unknown Client",
        machineIdentifier: entry.machineIdentifier,
        source: "server",
      }))
      .filter((entry) => entry.machineIdentifier);
  }

  async getClientsFromResources() {
    const body = await this.request(
      "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1",
      { baseUrl: "https://plex.tv" },
    );

    const parsed = parseXml(body);
    const devices = ensureArray(
      parsed?.MediaContainer?.Device ??
        parsed?.MediaContainer?.resource ??
        parsed?.resources?.resource ??
        parsed?.resources?.Device,
    );

    return devices
      .filter((device) => (device.provides || "").includes("player"))
      .map((device) => {
        const connections = sortedResourceConnections(device);
        return {
          title: device.name || "Unknown Resource",
          machineIdentifier: device.clientIdentifier || device.machineIdentifier,
          source: "resource",
          connections,
          accessToken: device.accessToken || this.plexToken,
        };
      })
      .filter((entry) => entry.machineIdentifier);
  }

  async listClients() {
    const [serverClients, resourceClients] = await Promise.all([
      this.getClientsFromServer(),
      this.getClientsFromResources().catch((error) => {
        console.warn(`Warning: resource discovery failed: ${error.message}`);
        return [];
      }),
    ]);

    const unique = new Map();

    // Start with resource entries (usually richer connection data).
    for (const client of resourceClients) {
      unique.set(client.machineIdentifier, client);
    }

    // Let server-discovered clients win for control path stability, while
    // preserving any extra resource connection hints as fallback targets.
    for (const client of serverClients) {
      const existing = unique.get(client.machineIdentifier);
      if (!existing) {
        unique.set(client.machineIdentifier, client);
        continue;
      }

      unique.set(client.machineIdentifier, {
        ...existing,
        ...client,
        connections: existing.connections || [],
        accessToken: existing.accessToken || this.plexToken,
      });
    }

    return [...unique.values()];
  }

  async listLibrarySections() {
    const body = await this.request("/library/sections");
    const container = toMediaContainer(body);
    const sections = ensureArray(container.Directory);

    return sections
      .map((section) => ({
        key: section.key,
        title: section.title,
      }))
      .filter((section) => section.key && section.title);
  }

  async listCollections(sectionKey) {
    const body = await this.request(`/library/sections/${sectionKey}/collections`);
    const container = toMediaContainer(body);
    const collections = ensureArray(container.Directory);

    return collections
      .map((collection) => ({
        key: collection.key,
        title: collection.title,
      }))
      .filter((collection) => collection.key && collection.title);
  }

  async findLibrarySectionByName(sectionName) {
    const sections = await this.listLibrarySections();

    const normalized = sectionName.trim().toLowerCase();
    const match = sections.find((section) => (section.title || "").trim().toLowerCase() === normalized);

    if (!match) {
      const available = sections.map((section) => section.title).filter(Boolean);
      throw new Error(`Library not found: ${sectionName}. Available: ${available.join(", ")}`);
    }

    return {
      key: match.key,
      title: match.title,
    };
  }

  async findCollectionByName(sectionKey, collectionName) {
    const collections = await this.listCollections(sectionKey);

    const normalized = collectionName.trim().toLowerCase();
    const match = collections.find((collection) =>
      (collection.title || "").trim().toLowerCase() === normalized,
    );

    if (!match) {
      const available = collections.map((collection) => collection.title).filter(Boolean);
      throw new Error(`Collection not found: ${collectionName}. Available: ${available.join(", ")}`);
    }

    return {
      key: match.key,
      title: match.title,
    };
  }

  async getCollectionItems(collectionKey) {
    const body = await this.request(collectionKey);
    const container = toMediaContainer(body);
    return containerItems(container);
  }

  async getShowEpisodes(showRatingKey) {
    const body = await this.request(`/library/metadata/${showRatingKey}/allLeaves`);
    const container = toMediaContainer(body);
    return containerItems(container).filter((item) => item.type === "episode");
  }

  async createPlayQueue(serverIdentity, { collectionKey, episodeKey, startEpisodeKey, shuffleContinuous = true }) {
    const params = new URLSearchParams({ type: "video" });

    if (shuffleContinuous) {
      params.set(
        "uri",
        `server://${serverIdentity.machineIdentifier}/${serverIdentity.libraryIdentifier}${collectionKey}`,
      );
      params.set("shuffle", "1");
      params.set("continuous", "1");
      params.set("key", startEpisodeKey || episodeKey);
    } else {
      params.set("uri", `server://${serverIdentity.machineIdentifier}/${serverIdentity.libraryIdentifier}${episodeKey}`);
    }

    const body = await this.request(`/playQueues?${params.toString()}`, { method: "POST" });
    const container = toMediaContainer(body);
    const playQueueID = container.playQueueID;

    if (!playQueueID) {
      throw new Error("Failed to create a play queue (playQueueID missing)");
    }

    return playQueueID;
  }

  async createDelegationToken() {
    const body = await this.request("/security/token?type=delegation&scope=all");
    const container = toMediaContainer(body);
    return container.token || null;
  }

  async playEpisodeOnClient(serverIdentity, client, episode, playQueueID, delegationToken = null) {
    const params = new URLSearchParams({
      commandID: String(this.nextCommandId()),
      providerIdentifier: "com.plexapp.plugins.library",
      machineIdentifier: serverIdentity.machineIdentifier,
      protocol: this.serverProtocol,
      address: this.serverAddress,
      port: String(this.serverPort),
      offset: "0",
      key: episode.key,
      type: "video",
      containerKey: `/playQueues/${playQueueID}?window=100&own=1`,
    });
    if (delegationToken) {
      params.set("token", delegationToken);
    }

    const commandPath = `/player/playback/playMedia?${params.toString()}`;
    const proxyOptions = {
      headers: {
        "X-Plex-Target-Client-Identifier": client.machineIdentifier,
      },
    };

    const directTargets =
      client.connections && client.connections.length > 0
        ? client.connections
        : [];

    if (directTargets.length > 0) {
      const directErrors = [];
      for (const target of directTargets) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const directOptions = {
            ...proxyOptions,
            baseUrl: target,
            token: client.accessToken || this.plexToken,
          };

          try {
            await this.request(commandPath, directOptions);
            return;
          } catch (directError) {
            directErrors.push(directError);
            if (!isNetworkError(directError) || attempt === 2) {
              break;
            }
            await sleep(700);
          }
        }
      }

      // As a last resort, retry through server proxy.
      try {
        await this.request(commandPath, proxyOptions);
        return;
      } catch (proxyError) {
        const firstDirect = directErrors[0];
        if (firstDirect) {
          throw new Error(
            `Direct playback failed (${firstDirect.message}); proxy playback failed (${proxyError.message})`,
          );
        }
        throw proxyError;
      }
    }

    await this.request(commandPath, proxyOptions);
  }
}
