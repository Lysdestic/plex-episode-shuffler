import { readConfig } from "./config.js";
import { PlexApi } from "./plex.js";
import { flattenEpisodes, matchClients, pickRandom } from "./utils.js";

export function formatEpisode(episode) {
  const season = String(episode.parentIndex || 0).padStart(2, "0");
  const number = String(episode.index || 0).padStart(2, "0");
  const show = episode.grandparentTitle || "Unknown Show";
  const title = episode.title || "Untitled";
  return show + " S" + season + "E" + number + " " + title;
}

function getLogger(logger) {
  if (!logger) return { log() {}, warn() {}, error() {} };
  return {
    log: typeof logger.log === "function" ? logger.log.bind(logger) : () => {},
    warn: typeof logger.warn === "function" ? logger.warn.bind(logger) : () => {},
    error: typeof logger.error === "function" ? logger.error.bind(logger) : () => {},
  };
}

export async function playRandomEpisode({ env = process.env, logger = console } = {}) {
  const log = getLogger(logger);
  const config = readConfig(env);
  const plex = new PlexApi(config);

  log.log("Connecting to Plex server...");
  const serverIdentity = await plex.getServerIdentity();

  log.log("Discovering Plex clients...");
  const clients = await plex.listClients();
  if (clients.length === 0) {
    throw new Error("No Plex clients found");
  }

  const { selected, unmatched } = matchClients(clients, config.clientHints);
  if (unmatched.length > 0) {
    const available = clients.map((client) => client.title).join(", ");
    throw new Error(
      "No matching client found for hint(s): " +
        unmatched.join(", ") +
        " | Available clients: " +
        available,
    );
  }

  log.log(
    "Using " + selected.length + " client(s): " + selected.map((client) => client.title).join(", "),
  );

  const section = await plex.findLibrarySectionByName(config.library);
  const collection = await plex.findCollectionByName(section.key, config.collection);

  log.log("Loading episodes from collection: " + collection.title);
  const collectionItems = await plex.getCollectionItems(collection.key);
  const { episodes: directEpisodes, showRatingKeys } = flattenEpisodes(collectionItems);

  const showEpisodesArrays = await Promise.all(
    showRatingKeys.map((ratingKey) => plex.getShowEpisodes(ratingKey)),
  );
  const episodes = [...directEpisodes, ...showEpisodesArrays.flat()];

  if (episodes.length === 0) {
    throw new Error("No episodes found in collection");
  }

  const episode = pickRandom(episodes);
  const episodeLabel = formatEpisode(episode);
  log.log("Playing: " + episodeLabel);

  const delegationToken = await plex.createDelegationToken();

  async function dispatchToClients(playQueueID) {
    const results = await Promise.allSettled(
      selected.map((client) =>
        plex.playEpisodeOnClient(serverIdentity, client, episode, playQueueID, delegationToken),
      ),
    );

    let successCount = 0;
    const failures = [];

    results.forEach((result, index) => {
      const client = selected[index];
      if (result.status === "fulfilled") {
        successCount += 1;
        log.log("OK: Playback started on " + client.title);
      } else {
        failures.push(client.title + ": " + (result.reason?.message || String(result.reason)));
        log.error(
          "FAIL: " + client.title + " -> " + (result.reason?.message || String(result.reason)),
        );
      }
    });

    return { successCount, failures };
  }

  const primaryQueueID = await plex.createPlayQueue(serverIdentity, {
    collectionKey: collection.key,
    episodeKey: episode.key,
    startEpisodeKey: episode.key,
    shuffleContinuous: config.shuffleContinuous,
  });

  let { successCount, failures } = await dispatchToClients(primaryQueueID);

  if (successCount === 0 && config.shuffleContinuous) {
    log.warn(
      "Shuffled continuous queue failed on all clients. Retrying with single-episode queue.",
    );
    const fallbackQueueID = await plex.createPlayQueue(serverIdentity, {
      collectionKey: collection.key,
      episodeKey: episode.key,
      startEpisodeKey: episode.key,
      shuffleContinuous: false,
    });
    ({ successCount, failures } = await dispatchToClients(fallbackQueueID));
  }

  if (successCount === 0) {
    throw new Error("Failed to start playback on all selected clients. " + failures.join(" | "));
  }

  if (failures.length > 0) {
    log.warn("Playback started on " + successCount + "/" + selected.length + " clients.");
  }

  return {
    ok: true,
    episode: episodeLabel,
    selectedClients: selected.map((client) => client.title),
    successCount,
    totalClients: selected.length,
    failures,
  };
}
