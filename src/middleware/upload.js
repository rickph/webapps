const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

function makeUploader(folder) {
  const dir = path.join(__dirname, '../../public/uploads/' + folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename:    (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      cb(null, name);
    },
  });

  const filter = (req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.webp'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error('Only images allowed'), ok);
  };

  return multer({ storage, fileFilter: filter, limits: { fileSize: 3 * 1024 * 1024 } });
}

module.exports = { makeUploader };
