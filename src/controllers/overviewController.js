const User = require('../models/User');
const Domain = require('../models/Domain');
const MockInterview = require('../models/MockInterview');
const ClientInterview = require('../models/ClientInterview');

exports.overview = async (req, res) => {
  try {
    const role = req.user.role;
    const seesAll = role === 'admin' || role === 'cto';
    const { category } = req.query;

    let buQuery = { role: 'bu', headOnly: { $ne: true } };
    if (seesAll) {
      if (category) buQuery.category = category;
    } else if (role === 'bu') {
      buQuery = { _id: require('../utils/scope').buFilter(req.user) };
    } else if (role === 'manager') {
      buQuery = { _id: req.user.businessUnit || null };
    } else {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const bus = await User.find(buQuery).populate('category', 'name');
    const buIds = bus.map((b) => b._id);
    const buCat = {};
    bus.forEach((b) => (buCat[String(b._id)] = b.category?.name || 'Uncategorized'));

    const scoped = seesAll && !category ? {} : { businessUnit: { $in: buIds } };
    const scopedBU = scoped.businessUnit ? { businessUnit: { $in: buIds } } : {};

    const [employees, trainers, ctoCount, mocks, clients, domainsCount] = await Promise.all([
      User.find({ role: 'employee', active: true, ...scoped }).select('jobStatus businessUnit'),
      User.countDocuments({ role: 'manager', ...scoped }),
      seesAll ? User.countDocuments({ role: 'cto' }) : Promise.resolve(0),
      MockInterview.find(scopedBU).select('status score scheduledAt'),
      ClientInterview.find(scopedBU).select('status'),
      Domain.countDocuments(scoped.businessUnit ? { active: true, businessUnit: { $in: buIds } } : { active: true }),
    ]);

    const statusCount = { on_training: 0, ongoing_interview: 0, deployed: 0 };
    const catCount = {};
    employees.forEach((e) => {
      statusCount[e.jobStatus] = (statusCount[e.jobStatus] || 0) + 1;
      const cat = buCat[String(e.businessUnit)] || 'Uncategorized';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
    const onBench = statusCount.on_training + statusCount.ongoing_interview;

    const mockScheduled = mocks.filter((m) => m.status === 'scheduled').length;
    const mockCompleted = mocks.filter((m) => m.status === 'completed').length;
    const scores = mocks.filter((m) => m.score != null).map((m) => m.score);
    const avgMockScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

    const now = new Date();
    const mocksOverTime = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - i * 7);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      mocksOverTime.push({
        week: `${start.getMonth() + 1}/${start.getDate()}`,
        count: mocks.filter((m) => { const t = new Date(m.scheduledAt); return t >= start && t < end; }).length,
      });
    }

    const clientOrder = ['sent', 'in_progress', 'selected', 'rejected', 'on_hold'];
    const clientCount = {}; clientOrder.forEach((s) => (clientCount[s] = 0));
    clients.forEach((c) => (clientCount[c.status] = (clientCount[c.status] || 0) + 1));

    res.json({
      kpis: {
        totalEngineers: employees.length,
        onBench,
        onTraining: statusCount.on_training,
        ongoingInterview: statusCount.ongoing_interview,
        deployed: statusCount.deployed,
        totalTrainers: trainers,
        totalBUs: buIds.length,
        totalCTOs: ctoCount,
        mockScheduled,
        mockCompleted,
        avgMockScore,
        clientsSent: clients.length,
        clientsSelected: clientCount.selected || 0,
        domains: domainsCount,
      },
      charts: {
        engineersByStatus: [
          { name: 'On training', value: statusCount.on_training },
          { name: 'Ongoing interview', value: statusCount.ongoing_interview },
          { name: 'Deployed', value: statusCount.deployed },
        ],
        engineersByCategory: Object.entries(catCount).map(([name, value]) => ({ name, value })),
        clientsByStatus: clientOrder.map((s) => ({ name: s, value: clientCount[s] })),
        mocksOverTime,
      },
    });
  } catch (e) {
    res.status(500).json({ message: 'Could not load overview' });
  }
};
