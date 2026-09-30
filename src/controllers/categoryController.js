const Category = require('../models/Category');
const { moveToTrash, archiveToTrash } = require('../utils/trash');
exports.listCategories = async (req, res) => {
  const categories = await Category.find({ active: true }).populate('parent', 'name').sort({ name: 1 });
  const tops = categories.filter((c) => !c.parent);
  const ordered = [];
  tops.forEach((t) => {
    ordered.push(t);
    categories.filter((c) => c.parent && String(c.parent._id) === String(t._id)).forEach((c) => ordered.push(c));
  });
  categories.filter((c) => c.parent && !tops.some((t) => String(t._id) === String(c.parent._id))).forEach((c) => ordered.push(c));
  res.json({
    categories: ordered.map((c) => ({
      _id: c._id,
      name: c.name,
      description: c.description,
      parent: c.parent ? c.parent._id : null,
      parentName: c.parent ? c.parent.name : null,
      label: c.parent ? `${c.parent.name} › ${c.name}` : c.name,
      createdAt: c.createdAt,
    })),
  });
};

exports.createCategory = async (req, res) => {
  const { name, description, parent } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Category name is required' });
  let parentCat = null;
  if (parent) {
    parentCat = await Category.findOne({ _id: parent, active: true });
    if (!parentCat) return res.status(400).json({ message: 'Parent category not found' });
    if (parentCat.parent) return res.status(400).json({ message: 'Sub-categories can only be created under a main category' });
  }
  const exists = await Category.findOne({ name: name.trim(), active: true });
  if (exists) return res.status(409).json({ message: 'A category with this name already exists' });
  const category = await Category.create({
    name: name.trim(),
    description: (description || '').trim(),
    parent: parentCat ? parentCat._id : null,
    createdBy: req.user._id,
  });
  res.status(201).json({ category });
};

exports.deleteCategory = async (req, res)  => {
  const c = await Category.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Category not found' });
  const subs = await Category.countDocuments({ parent: c._id, active: true });
  if (subs) return res.status(409).json({ message: `Remove its ${subs} sub-categor${subs === 1 ? 'y' : 'ies'} first` });
  c.active = false;
  await c.save();
  await archiveToTrash(req, { entity: 'category', label: c.name || 'Category', model: 'Category', id: c._id });
  res.json({ message: 'Category moved to Recycle Bin. An admin can restore it within 30 days.' });
};
