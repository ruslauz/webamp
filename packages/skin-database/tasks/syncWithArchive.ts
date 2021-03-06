import { knex } from "../db";
import path from "path";
import fetch from "node-fetch";
import _temp from "temp";
import fs from "fs";
import child_process from "child_process";
import UserContext from "../data/UserContext";
import SkinModel from "../data/SkinModel";
import util from "util";
import * as Parallel from "async-parallel";
const exec = util.promisify(child_process.exec);

const CONCURRENT = 5;

const temp = _temp.track();

async function allItems(): Promise<string[]> {
  const r = await fetch(
    "https://archive.org/advancedsearch.php?q=collection%3Awinampskins+skintype%3Awsz&fl%5B%5D=identifier&fl%5B%5D=skintype&sort%5B%5D=&sort%5B%5D=&sort%5B%5D=&rows=100000&page=1&output=json&save=yes"
  );
  const result = await r.json();
  const response = result.response;
  const numFound = response.numFound;
  const items = response.docs;
  if (items.length !== numFound) {
    console.error(`Expected to find ${numFound} items but saw ${items.length}`);
  }
  items.forEach((item) => {
    if (item.skintype !== "wsz") {
      throw new Error(`${item.identifier} has skintype of ${item.skintype}`);
    }
  });
  return items.map((item: { identifier: string }) => item.identifier);
}

async function ensureIaRecord(
  ctx: UserContext,
  identifier: string
): Promise<void> {
  const dbItem = await knex("ia_items").where({ identifier }).first();
  if (dbItem) {
    return;
  }
  const r = await fetch(`https://archive.org/metadata/${identifier}`);
  const response = await r.json();
  const files = response.files;
  const skins = files.filter((file) => file.name.endsWith(".wsz"));
  if (skins.length !== 1) {
    console.error(
      `Expected to find one skin file for "${identifier}", found ${skins.length}`
    );
    return;
  }
  const md5 = skins[0].md5;
  const skin = await SkinModel.fromMd5(ctx, md5);
  if (skin == null) {
    console.error(
      `We don't have a record for the skin found in "${identifier}"`
    );
    return;
  }

  await knex("ia_items").insert({ skin_md5: md5, identifier });
  console.log(`Inserted "${identifier}".`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function collectExistingItems(ctx: UserContext) {
  const items = await allItems();
  await Parallel.each(
    items,
    async (identifier) => {
      await ensureIaRecord(ctx, identifier);
    },
    CONCURRENT
  );
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_\-.]/g, "_").replace(/^\d*/, "");
}

async function downloadToTemp(url: string, filename: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download from ${filename} from ${url}`);
  }
  const result = await response.buffer();
  const tempDir = temp.mkdirSync();
  const tempFile = path.join(tempDir, filename);
  fs.writeFileSync(tempFile, result);
  return tempFile;
}

async function getNewIdentifier(filename: string): Promise<string> {
  const identifierBase = `winampskins_${sanitize(path.parse(filename).name)}`;
  let counter = 0;
  function getIdentifier() {
    return identifierBase + (counter === 0 ? "" : `_${counter}`);
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await knex("ia_items").whereRaw(
      "LOWER(identifier) = LOWER(?)",
      getIdentifier()
    );
    if (existing.length === 0) {
      break;
    }
    counter++;
  }
  return getIdentifier();
}

async function archive(skin: SkinModel): Promise<string> {
  const filename = await skin.getFileName();
  if (filename == null) {
    throw new Error(`Could archive skin. Filename not found. ${skin.getMd5()}`);
  }

  if (
    !(
      filename.toLowerCase().endsWith(".wsz") ||
      filename.toLowerCase().endsWith(".zip")
    )
  ) {
    throw new Error(
      `Unexpected file extension for ${skin.getMd5()}: ${filename}`
    );
  }

  const screenshotFilename = filename.replace(/\.(wsz|zip)$/, ".png");
  const title = `Winamp Skin: ${filename}`;

  const [skinFile, screenshotFile] = await Promise.all([
    downloadToTemp(skin.getSkinUrl(), filename),
    downloadToTemp(skin.getScreenshotUrl(), screenshotFilename),
  ]);

  // Pick identifier
  const identifier = await getNewIdentifier(filename);

  const command = `ia upload ${identifier} "${skinFile}" "${screenshotFile}" --metadata="collection:winampskins" --metadata="skintype:wsz" --metadata="mediatype:software" --metadata="title:${title}"`;
  await exec(command, { encoding: "utf8" });
  await knex("ia_items").insert({ skin_md5: skin.getMd5(), identifier });
  return identifier;
}

const CORRUPT = new Set([
  "2e146de10eef96773ea222fefad52eeb",
  "c3d2836f7f1b91d87d60b93aadf6981a",
  "4288c254d9a22024c48601db5f9812e9",
  "042271e3aea64970a885a8ab1cfe4a3f",
  "0c91d27d8d9ee11ead8306f49dde0001",
  "11944ffeec82f2d01d03cbfbb7783638",
  "2043521751c6ba9b5c021f47afb28b64",
  "72a399cbe37287371413680faccf40e1",
  "6ba8c688c0cffad19ef3e410f9949233",
  "b02cd2ee5b1e5237171c3b23df6f5194",
  "b5554df8cf1048731d1292c609293166",
  "3ca48d8f5b8b0590fee9a45e4eeb3297",
  "096b26067ad5b0eabac47e40e2d9329e",
  "2071b45150b9f3d640f9465051d32be3",
  "6c1673efa65d1d53b4564d2ec7917d07",
  "7749d85b72e8932f718c935211619390",
  "7b32e418a29221d6a527c4e72de8be78",
  "92eb393f78032405047a664cd99afcf5",
  "bd0c3335fa70e7bb1cde8541c2a46139",
  "bf390919a562a18bd8c669b6ebebe07a",
  "c03255f333e2afcda76e1691e46c4dc7",
  "c2e29dfb715bc37fea6b61e770bc902c",
  "dae8579c14dc1b7738340a5f8dbffbc2",
  "e2b29e7b4611b462c660575dd42ff458",
  "e2b29e7b4611b462c660575dd42ff458",
  "ea7f8863f58e42ea9fd1202a791187f1",
  "ec3558f28f058cb1f147191ad19179eb",
  "f014dae16799191a52b35c2f2aec1a74",
  "23e09ddef5c380fe39ec94cf941433da",
  "9592c095fb330699f95f771cc09a4654",
  "d181107c52f97359aa39689f1611887c",
  "dc61584841396e93b802efe82e1f18a8",
  "de6708ea2adbfd756c1b4ee742a415a5",
  "dec7b913d7092dfed2abafee45762eb5",
  "a8f5a330362cde7ec97303564ce921be",
  "07e165e6776f6e7b6a57c8db18af458f",
  "a3d2b4e9894829fc7da23d054e2f4fcf",
  "38c3d55bafd914eb647e8422f559e7fc",
  "43505b99a3fa965a6823858539736370",
  "04d172dc3f08d7fc1c9a047db956ea5d",
  "515941f5dee8ab399bd0e58d0a116274",
  "6b00596f4519fcc9d8bff7a69194333a",
]);

export async function syncWithArchive() {
  const ctx = new UserContext();
  // Ensure we know about all items in the `winampskins` collection.
  // console.log("Going to ensure we know about all archive items");
  // await collectExistingItems(ctx);
  console.log("Checking which new skins we have...");
  const unarchived = await knex("skins")
    .leftJoin("ia_items", "ia_items.skin_md5", "=", "skins.md5")
    .where({ "ia_items.id": null, skin_type: 1 })
    .select("skins.md5");

  console.log(`Found ${unarchived.length} skins to upload`);

  await Parallel.map(
    unarchived.filter(({ md5 }) => !CORRUPT.has(md5)),
    async ({ md5 }) => {
      const skin = await SkinModel.fromMd5(ctx, md5);
      if (skin == null) {
        throw new Error(`Expected to get skin for ${md5}`);
      }
      try {
        console.log(`Attempting to upload ${md5}`);
        const identifier = await archive(skin);
        console.log(`SUCCESS! Uplaoded ${md5} as ${identifier}`);
      } catch (e) {
        console.log("Archive failed...");
        if (/error checking archive/.test(e.message)) {
          console.log(`Corrupt archvie: ${skin.getMd5()}`);
        } else if (
          /archive files are not allowed to contain encrypted content/.test(
            e.message
          )
        ) {
          console.log(`Corrupt archvie (encrypted): ${skin.getMd5()}`);
        } else if (/case alias may already exist/.test(e.message)) {
          console.log(`Invalid name (case alias): ${skin.getMd5()}`);
        } else {
          console.error(e);
        }
      }
    },
    CONCURRENT
  );
}
