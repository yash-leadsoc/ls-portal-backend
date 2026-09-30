const { bumpStreak } = require('../utils/streak');
const { moveToTrash, archiveToTrash } = require('../utils/trash');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const { buOf, seesAll, ownerScope, contentFilter, inContent } = require('../utils/scope');
const MaterialReview = require('../models/MaterialReview');
const { UPLOAD_DIR } = require('../middleware/upload');
const os = require('os');
const cloudinary = require('../config/cloudinary');
const { spawn } = require('child_process');
const Domain = require('../models/Domain');
const { logAudit } = require('../utils/audit');
function convertToPdf(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('soffice', [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outputDir,
      inputPath,
    ]);

    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(
          new Error(`LibreOffice failed: ${stderr}`)
        );
      }

      const pdfName =
        `${path.basename(inputPath, path.extname(inputPath))}.pdf`;

      const pdfPath = path.join(outputDir, pdfName);

      if (!fs.existsSync(pdfPath)) {
        return reject(
          new Error('PDF was not created')
        );
      }

      resolve(pdfPath);
    });
  });
}

async function downloadToTemp(url, extension) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Cloudinary download failed: ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  const tempPath = path.join(
    os.tmpdir(),
    `leadsoc_${Date.now()}${extension}`
  );

  fs.writeFileSync(tempPath, buffer);

  return tempPath;
}

exports.upload = async (req, res) => {
  let tempInputPath = null;
  let tempOutputDir = null;
  let cloudinaryResult = null;

  try {
    const {
      title,
      description,
      domainId,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({
        message: 'File is required',
      });
    }

    if (!domainId) {
      return res.status(400).json({
        message: 'Domain is required',
      });
    }

    tempInputPath = req.file.path;

    const extension = path
      .extname(req.file.originalname)
      .toLowerCase();

    const officeExtensions = [
      '.ppt',
      '.pptx',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.odt',
      '.ods',
      '.odp',
    ];

    let pdfPath;

    if (officeExtensions.includes(extension)) {
      tempOutputDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'leadsoc_pdf_')
      );

      pdfPath = await convertToPdf(
        tempInputPath,
        tempOutputDir
      );
    }

    else if (extension === '.pdf') {
      pdfPath = tempInputPath;
    }

    else {
      return res.status(400).json({
        message: 'Only PDF, PPT, PPTX, DOC, DOCX, XLS and XLSX files are supported',
      });
    }

    if (!fs.existsSync(pdfPath)) {
      throw new Error(
        `PDF does not exist: ${pdfPath}`
      );
    }

    cloudinaryResult =
      await cloudinary.uploader.upload(
        pdfPath,
        {
          resource_type: 'image',
          folder: 'leadsoc-training/materials',
          use_filename: true,
          unique_filename: true,
          format: 'pdf',
        }
      );

    const _scope = await ownerScope(req.user, req.body && req.body.businessUnit);
    if (req.user.role === 'bu' && domainId) {
      const _dom = await Domain.findById(domainId).select('businessUnit');
      if (_dom && _dom.businessUnit && inContent(req.user, _dom.businessUnit)) _scope.businessUnit = _dom.businessUnit;
    }
    const document = await Document.create({
      title,
      description: description || '',

      domain: domainId,
      businessUnit: _scope.businessUnit,

      uploadedBy: req.user._id,

      uploaderRole: req.user.role,

      originalName: req.file.originalname,

      fileName:
        `${path.basename(
          req.file.originalname,
          extension
        )}.pdf`,

      cloudinaryPublicId:
        cloudinaryResult.public_id,

      cloudinaryUrl:
        cloudinaryResult.secure_url,

      cloudinaryResourceType: 'image',
    });

    if (
      tempInputPath &&
      fs.existsSync(tempInputPath)
    ) {
      fs.unlinkSync(tempInputPath);
    }

    if (
      tempOutputDir &&
      fs.existsSync(tempOutputDir)
    ) {
      fs.rmSync(
        tempOutputDir,
        {
          recursive: true,
          force: true,
        }
      );
    }

    return res.status(201).json(document);
  } catch (error) {
    if (cloudinaryResult?.public_id) {
      try {
        await cloudinary.uploader.destroy(
          cloudinaryResult.public_id,
          {
            resource_type: 'image',
            type: 'upload',
          }
        );
      } catch (e) {
      }
    }

    if (
      tempInputPath &&
      fs.existsSync(tempInputPath)
    ) {
      fs.unlinkSync(tempInputPath);
    }

    if (
      tempOutputDir &&
      fs.existsSync(tempOutputDir)
    ) {
      fs.rmSync(
        tempOutputDir,
        {
          recursive: true,
          force: true,
        }
      );
    }

    return res.status(500).json({
      message:
        error.message || 'Upload failed',
    });
  }
};

exports.list = async (req, res) => {
  try {
    const { domainId } = req.query;

    const filter = {};

    if (!seesAll(req.user)) filter.businessUnit = contentFilter(req.user);

    if (domainId) {
      filter.domain = domainId;
    }

    if (req.user.role === 'employee') {
      const assignedDomainIds = (req.user.assignedDomains || []).map(
        (id) => id?._id || id
      );

      if (domainId) {
        const allowed = assignedDomainIds.some(
          (id) => String(id) === String(domainId)
        );

        if (!allowed) {
          return res.status(403).json({
            message: 'You are not assigned to this domain',
          });
        }
      } else {
        filter.domain = {
          $in: assignedDomainIds,
        };
      }
    }

    const documents = await Document.find(filter)
      .populate('domain', 'name icon description')
      .populate('uploadedBy', 'name email employeeCode')
      .sort({ createdAt: -1 });

    return res.json({
      documents,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load documents',
    });
  }
};

exports.getOne = async (req, res) => {
  const doc = await Document.findById(req.params.id)
    .populate('domain', 'key name')
    .populate('uploadedBy', 'name role');
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  res.json({ document: doc });
};

exports.download = async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  const filePath = path.join(UPLOAD_DIR, doc.fileName);
  if (!fs.existsSync(filePath)) return res.status(410).json({ message: 'File missing on server' });

  if (req.user.role === 'employee') {
    await MaterialReview.findOneAndUpdate(
      { document: doc._id, employee: req.user._id },
      { $set: { reviewed: true }, $inc: { downloadCount: 1 } },
      { upsert: true, new: true }
    );
    bumpStreak(req.user._id);
  }

  res.download(filePath, doc.originalName);
};

exports.preview = async (req, res) => {
  try {
    const document = await Document.findById(
      req.params.id
    );

    if (!document) {
      return res.status(404).json({
        message: 'Document not found',
      });
    }

    if (!document.cloudinaryUrl) {
      return res.status(404).json({
        message: 'Cloudinary PDF not found',
      });
    }

    return res.redirect(
      document.cloudinaryUrl
    );
  } catch (error) {
    return res.status(500).json({
      message: 'Preview failed',
    });
  }
};

exports.markReviewed = async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  const review = await MaterialReview.findOneAndUpdate(
    { document: doc._id, employee: req.user._id },
    { $set: { reviewed: req.body.reviewed !== false } },
    { upsert: true, new: true }
  );
  if (req.user.role === 'employee') bumpStreak(req.user._id);
  res.json({ review });
};

exports.remove = async (req, res) => {
  try {
    const document = await Document.findById(
      req.params.id
    );

    if (!document) {
      return res.status(404).json({
        message: 'Document not found',
      });
    }

    // if (document.cloudinaryPublicId) {
    //   try {
    //     await cloudinary.uploader.destroy(
    //       document.cloudinaryPublicId,
    //       {
    //         resource_type:
    //           document.cloudinaryResourceType ||
    //           'image',
    //         type: 'upload',
    //       }
    //     );
    //   } catch (cloudinaryError) {
    //   }
    // }

    // if (document.fileName) {
    //   const localPath = path.join(
    //     process.env.UPLOAD_DIR ||
    //     path.join(process.cwd(), 'uploads'),
    //     document.fileName
    //   );

    //   if (fs.existsSync(localPath)) {
    //     fs.unlinkSync(localPath);
    //   }
    // }

    // await Document.findByIdAndDelete(
    //   document._id
    // );

    const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    await moveToTrash(req, {
      entity: 'document',
      label: document.title,
      docs: [{ model: 'Document', doc: document }],
      files: [
        {
          publicId: document.cloudinaryPublicId || null,
          resourceType: document.cloudinaryResourceType || 'image',
          localPath: document.fileName ? path.join(uploadRoot, document.fileName) : null,
        },
      ],
    });



    await logAudit(req, {
      action: 'delete', entity: 'document',
      entityId: document._id, entityLabel: document.title,
    });

    return res.json({
      message:
        'Document moved to Recycle Bin. An admin can restore it within 30 days.',
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to delete document',
    });
  }
};

exports.removeAll = async (req, res) => {
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      const files = fs.readdirSync(UPLOAD_DIR);

      for (const file of files) {
        const filePath = path.join(UPLOAD_DIR, file);

        fs.rmSync(filePath, {
          recursive: true,
          force: true,
        });
      }
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const result = await Document.deleteMany({});

    res.json({
      message: 'All documents deleted successfully',
      deletedDocuments: result.deletedCount,
    });
  } catch (err) {
    res.status(500).json({
      message: 'Failed to delete all documents',
    });
  }
};

function youtubeEmbed(url) {
  if (!url) return null;
  const u = String(url).trim();
  let m, id = null;
  if ((m = u.match(/[?&]v=([\w-]{6,})/))) id = m[1];
  else if ((m = u.match(/youtu\.be\/([\w-]{6,})/))) id = m[1];
  else if ((m = u.match(/youtube\.com\/embed\/([\w-]{6,})/))) id = m[1];
  else if ((m = u.match(/youtube\.com\/shorts\/([\w-]{6,})/))) id = m[1];
  else if ((m = u.match(/youtube\.com\/live\/([\w-]{6,})/))) id = m[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

exports.createLink = async (req, res) => {
  try {
    const { title, description, domainId, type, url, html } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: 'Title is required' });
    if (!domainId) return res.status(400).json({ message: 'Domain is required' });
    if (!['youtube', 'html'].includes(type)) return res.status(400).json({ message: 'Invalid material type' });

    let cloudinaryUrl = null, sourceUrl = null, htmlContent = null;
    let originalName = title.trim(), mimeType = 'text/html', size = 0;

    if (type === 'youtube') {
      const embed = youtubeEmbed(url);
      if (!embed) return res.status(400).json({ message: 'Please provide a valid YouTube link' });
      cloudinaryUrl = embed;
      sourceUrl = String(url).trim();
      originalName = `${title.trim()} (YouTube)`;
      mimeType = 'video/youtube';
    } else {
      if (!html || !html.trim()) return res.status(400).json({ message: 'HTML content is required' });
      htmlContent = html;
      cloudinaryUrl = 'data:text/html;base64,' + Buffer.from(html, 'utf8').toString('base64');
      originalName = `${title.trim()}.html`;
      size = Buffer.byteLength(html, 'utf8');
    }

    const _scope = await ownerScope(req.user, req.body && req.body.businessUnit);
    if (req.user.role === 'bu' && domainId) {
      const _dom = await Domain.findById(domainId).select('businessUnit');
      if (_dom && _dom.businessUnit && inContent(req.user, _dom.businessUnit)) _scope.businessUnit = _dom.businessUnit;
    }
    const doc = await Document.create({
      title: title.trim(),
      description: (description || '').trim(),
      domain: domainId,
      businessUnit: _scope.businessUnit,
      fileName: 'link',
      originalName, mimeType, size,
      uploadedBy: req.user._id,
      uploaderRole: req.user.role,
      type, sourceUrl, htmlContent,
      cloudinaryUrl, previewUrl: cloudinaryUrl,
      cloudinaryResourceType: 'link',
    });

    await logAudit(req, {
      action: 'create', entity: 'document',
      entityId: doc._id, entityLabel: doc.title,
    });

    res.status(201).json({ document: doc });
  } catch (e) {
    res.status(500).json({ message: 'Could not create material' });
  }
};
