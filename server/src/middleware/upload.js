const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function makeStorage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, '../../uploads', subdir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });
}

const photoUpload = multer({
  storage: makeStorage('inspections'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    cb(null, allowed.test(file.mimetype));
  },
});

const csvUpload = multer({
  storage: makeStorage('routes'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /csv|xlsx|xls/;
    cb(null, allowed.test(path.extname(file.originalname).slice(1).toLowerCase()) || allowed.test(file.mimetype));
  },
});

module.exports = { photoUpload, csvUpload };
