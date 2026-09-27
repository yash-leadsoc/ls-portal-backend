require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const User = require('../models/User');
const Domain = require('../models/Domain');

const DOMAINS = [
  { key: 'sta', name: 'STA', description: 'Static timing analysis', icon: '⏱️' },
  { key: 'synthesis', name: 'Synthesis', description: 'RTL to gate-level', icon: '⚙️' },
  { key: 'lec', name: 'LEC', description: 'Logical equivalence check', icon: '⇄' },
  { key: 'clp', name: 'CLP', description: 'Conformal low power', icon: '⚡' },
  { key: 'pnr', name: 'PNR', description: 'Place and route', icon: '🗺️' },
  { key: 'emir', name: 'EMIR', description: 'EM / IR drop analysis', icon: '〰️' },
];

async function run() {
  await connectDB();

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@leadsoc.com').toLowerCase();
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = new User({
      name: process.env.SEED_ADMIN_NAME || 'Program Admin',
      email: adminEmail,
      employeeCode: 'LS-ADMIN-01',
      role: 'admin',
    });
    await admin.setPassword(process.env.SEED_ADMIN_PASSWORD || 'Admin@123');
    await admin.save();
  } else {
  }

  for (const d of DOMAINS) {
    const exists = await Domain.findOne({ key: d.key });
    if (!exists) {
      await Domain.create({ ...d, createdBy: admin._id });
    }
  }

  if (process.env.SEED_DEMO === 'true') {
    let mgr = await User.findOne({ email: 'manager@leadsoc.com' });
    if (!mgr) {
      mgr = new User({
        name: 'Program Manager',
        email: 'manager@leadsoc.com',
        employeeCode: 'LS-MGR-01',
        role: 'manager',
        createdBy: admin._id,
      });
      await mgr.setPassword('Manager@123');
      await mgr.save();
    }

    let emp = await User.findOne({ email: 'engineer@leadsoc.com' });
    if (!emp) {
      emp = new User({
        name: 'Arjun Nair',
        email: 'engineer@leadsoc.com',
        employeeCode: 'LS-2291',
        role: 'employee',
        createdBy: mgr._id,
        manager: mgr._id,
      });
      await emp.setPassword('Engineer@123');
      await emp.save();
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  process.exit(1);
});
