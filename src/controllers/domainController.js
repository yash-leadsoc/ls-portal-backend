const Domain = require('../models/Domain');
const { logAudit } = require('../utils/audit');
const { buOf, seesAll, ownerScope } = require('../utils/scope');
const { moveToTrash, archiveToTrash } = require('../utils/trash');
exports.list = async (req, res) => {
  try {
    const q = { active: true };
    if (!seesAll(req.user)) q.businessUnit = buOf(req.user);
    const domains = await Domain.find(q).populate('category', 'name').sort({ name: 1 });

    if (
      req.user.role === 'admin' ||
      req.user.role === 'cto' ||
      req.user.role === 'bu' ||
      req.user.role === 'manager'
    ) {
      return res.json({
        domains: domains.map((domain) => {
          const o = domain.toObject();
          return { ...o, categoryName: o.category?.name || null, category: o.category?._id || o.category || null, assigned: true };
        }),
      });
    }

    const assignedDomainIds = (
      req.user.assignedDomains || []
    ).map((domain) =>
      String(domain?._id || domain)
    );

    const result = domains.map((domain) => {
      const o = domain.toObject();
      return {
        ...o,
        categoryName: o.category?.name || null,
        category: o.category?._id || o.category || null,
        assigned: assignedDomainIds.includes(String(domain._id)),
      };
    });

    return res.json({
      domains: result,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to load domains',
    });
  }
};

exports.create = async (req, res) => {
  try {
    const { key, name, description, icon } = req.body;
    if (!key || !name) return res.status(400).json({ message: 'key and name are required' });
    const exists = await Domain.findOne({ key: key.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'Domain key already exists' });
    const { businessUnit, category } = await ownerScope(req.user);
    const domain = await Domain.create({
      key: key.toLowerCase(),
      name,
      description: description || '',
      icon: icon || '📘',
      createdBy: req.user._id,
      businessUnit,
      category,
    });
    await logAudit(req, {
      action: 'create', entity: 'domain',
      entityId: domain._id, entityLabel: domain.name,
    });
    res.status(201).json({ domain });
  } catch (err) {
    res.status(500).json({ message: 'Could not create domain' });
  }
};

exports.update = async (req, res) => {
  const domain = await Domain.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!domain) return res.status(404).json({ message: 'Domain not found' });
  res.json({ domain });
};

exports.remove = async (req, res) => {
  const domain = await Domain.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!domain) return res.status(404).json({ message: 'Domain not found' });
  res.json({ message: 'Domain archived' });
};

exports.deleteDomain = async (req, res) => {
  const domain = await Domain.findById(req.params.id);
  if (!domain) return res.status(404).json({ message: 'Domain not found' });
  domain.active = false;
  await domain.save();
  await archiveToTrash(req, { entity: 'domain', label: domain.name || 'Domain', model: 'Domain', id: domain._id });
  await logAudit(req, {
    action: 'delete', entity: 'domain',
    entityId: domain._id, entityLabel: domain.name,
  });
    res.json({ message: 'Domain moved to Recycle Bin. An admin can restore it within 30 days.' });
};
