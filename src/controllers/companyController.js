const Company = require('../models/Company');
const { moveToTrash, archiveToTrash } = require('../utils/trash');
exports.listCompanies = async (req, res) => {
  const q = { active: true };
  if (req.query.category) q.category = req.query.category;
  const companies = await Company.find(q).populate('category', 'name').sort({ name: 1 });
  res.json({
    companies: companies.map((c) => ({
      _id: c._id, name: c.name,
      category: c.category?._id || null,
      categoryName: c.category?.name || null,
    })),
  });
};

exports.createCompany = async (req, res) => {
  const { name, categoryId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Company name is required' });
  const exists = await Company.findOne({ name: name.trim(), active: true });
  if (exists) return res.status(409).json({ message: 'Company already exists' });
  const company = await Company.create({ name: name.trim(), category: categoryId || null, createdBy: req.user._id });
  res.status(201).json({ company });
};

exports.deleteCompany = async (req, res) => {
  const c = await Company.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Company not found' });
  c.active = false; await c.save();
  await archiveToTrash(req, { entity: 'company', label: c.name || 'Company', model: 'Company', id: c._id });
  res.json({ message: 'Company moved to Recycle Bin. An admin can restore it within 30 days.' });
};
