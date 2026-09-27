const Category = require('../models/Category');

exports.listCategories = async (req, res) => {
  const categories = await Category.find({ active: true }).sort({ name: 1 });
  res.json({ categories });
};

exports.createCategory = async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Category name is required' });
  const exists = await Category.findOne({ name: name.trim(), active: true });
  if (exists) return res.status(409).json({ message: 'A category with this name already exists' });
  const category = await Category.create({
    name: name.trim(),
    description: (description || '').trim(),
    createdBy: req.user._id,
  });
  res.status(201).json({ category });
};

exports.deleteCategory = async (req, res) => {
  const c = await Category.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Category not found' });
  c.active = false;
  await c.save();
  res.json({ message: 'Category removed' });
};
