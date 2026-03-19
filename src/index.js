import dotenv from "dotenv";
import { playRandomEpisode } from "./playback.js";

dotenv.config({ quiet: true });

playRandomEpisode({ logger: console }).catch((error) => {
  console.error("Error: " + error.message);
  process.exitCode = 1;
});
