const fs = require("fs");
const path = require("path");
const multer = require("multer");

const B2_CONFIGURED = !!(
  process.env.B2_BUCKET_NAME &&
  process.env.B2_BUCKET_ID &&
  process.env.B2_KEY &&
  process.env.B2_KEY_ID
);

const TMP_DIR = process.env.TMP_UPLOAD_DIR || "tmp";
const LOCAL_MEDIA_DIR =
  process.env.LOCAL_MEDIA_DIR || path.join("public", "media");
const LOCAL_MEDIA_URL_PATH = (
  process.env.LOCAL_MEDIA_URL_PATH || "/media"
).replace(/\/$/, "");

// settings

const MAX_FILE_SIZE = 100 * (1000 * 1000); // 100mb
const MAX_FILE_COUNT = 10;

//

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });

if (B2_CONFIGURED) {
  console.log(
    "b2 credentials found — media uploads will use b2 remote storage.",
  );
} else {
  console.log(
    `b2 credentials not configured — media uploads will be stored locally in ${LOCAL_MEDIA_DIR}.`,
  );
}

exports.none = multer({ storage: multer.memoryStorage() }).none();

exports.uploadMulter = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => {
      cb(null, nanoid(16));
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILE_COUNT,
  },
}).array("files");

exports.storeMedia = async (file) => {
  if (B2_CONFIGURED) {
    return exports.uploadB2(file);
  }

  return exports.storeLocal(file);
};

exports.storeLocal = async (file) => {
  const fileName = createStoredFileName(file.originalname);
  const destination = path.join(LOCAL_MEDIA_DIR, fileName);

  await fs.promises.rename(file.path, destination);
  file.stored = true;

  return `${LOCAL_MEDIA_URL_PATH}/${fileName}`;
};

exports.uploadB2 = async (file) => {
  const B2 = require("backblaze-b2");
  const b2 = new B2({
    applicationKeyId: process.env.B2_KEY_ID,
    applicationKey: process.env.B2_KEY,
  });
  const auth_response = await b2.authorize();
  const { downloadUrl } = auth_response.data;

  const response = await b2.getUploadUrl({
    bucketId: process.env.B2_BUCKET_ID,
  });
  const { authorizationToken, uploadUrl } = response.data;

  const fileName = createStoredFileName(file.originalname);
  const file_info = await b2.uploadFile({
    uploadUrl,
    uploadAuthToken: authorizationToken,
    fileName,
    data: fs.readFileSync(file.path),
  });

  if (file_info.data?.fileName ?? null) {
    return `${downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${file_info.data.fileName}`;
  }

  return;
};

function createStoredFileName(originalName) {
  const ext = path
    .extname(originalName || "")
    .replace(/[^a-zA-Z0-9.]/g, "")
    .slice(0, 16);
  const base =
    path
      .basename(originalName || "upload", ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "upload";
  const date = new Date().toISOString().slice(0, 10);

  return `${nanoid(8)}-${date}-${base}${ext}`;
}

// https://www.npmjs.com/package/nanoid
function nanoid(e = 21) {
  let a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  let t = "",
    r = crypto.getRandomValues(new Uint8Array(e));
  for (let n = 0; n < e; n++) t += a[63 & r[n]];
  return t;
}
