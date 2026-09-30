const Question = require('../models/Question');
const { buOf, seesAll, ownerScope, buFilter } = require('../utils/scope');
const Answer = require('../models/Answer');
const User = require('../models/User');

const {
  createNotification,
  notifyUsers,
} = require('../services/pushNotification');
const { logAudit } = require('../utils/audit');
exports.listQuestions = async (req, res) => {
  try {
    const _q = {};
    if (!seesAll(req.user)) _q.businessUnit = buFilter(req.user);
    const questions = await Question.find(_q)
      .populate('author', 'name role')
      .sort({ createdAt: -1 });

    const counts = await Answer.aggregate([
      { $group: { _id: '$question', n: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => (countMap[String(c._id)] = c.n));

    res.json({
      questions: questions.map((q) => ({
        id: q._id,
        title: q.title,
        body: q.body,
        author: q.author ? { id: q.author._id, name: q.author.name, role: q.author.role } : null,
        answerCount: countMap[String(q._id)] || 0,
        createdAt: q.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load questions' });
  }
};

exports.getQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).populate('author', 'name role');
    if (!question) return res.status(404).json({ message: 'Question not found' });

    const answers = await Answer.find({ question: question._id })
      .populate('author', 'name role')
      .sort({ createdAt: 1 });

    res.json({
      question: {
        id: question._id,
        title: question.title,
        body: question.body,
        author: question.author
          ? { id: question.author._id, name: question.author.name, role: question.author.role }
          : null,
        createdAt: question.createdAt,
      },
      answers: answers.map((a) => ({
        id: a._id,
        body: a.body,
        author: a.author ? { id: a.author._id, name: a.author.name, role: a.author.role } : null,
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load question' });
  }
};

exports.createQuestion = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: 'A question title is required' });

    const _scope = await ownerScope(req.user);
    const q = await Question.create({
      businessUnit: _scope.businessUnit,
      title: title.trim(),
      body: (body || '').trim(),
      author: req.user._id,
    });

    await logAudit(req, {
      action: 'create', entity: 'question',
      entityId: q._id, entityLabel: q.title,
    });

    const recipients = await User.find({
      active: true,
      businessUnit: q.businessUnit,
      _id: {
        $ne: req.user._id,
      },
    }).select('_id');

    try {
      await notifyUsers(
        recipients.map((user) => user._id),
        {
          type: 'COMMUNITY_QUESTION',
          title: 'New Community Question',
          body: `${req.user.name} posted a new question: ${q.title}`,
          url: `/community?question=${q._id}`,
        }
      );
    } catch (notificationError) {
    }

    res.status(201).json({
      question: {
        id: q._id,
        title: q.title,
        body: q.body,
        author: { id: req.user._id, name: req.user.name, role: req.user.role },
        answerCount: 0,
        createdAt: q.createdAt,
      },
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to post question' });
  }
};

exports.createAnswer = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ message: 'Answer text is required' });

    const question = await Question.findById(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found' });

    const a = await Answer.create({
      question: question._id,
      body: body.trim(),
      author: req.user._id,
    });

    if (
      question.author &&
      String(question.author) !== String(req.user._id)
    ) {
      await createNotification({
        userId: question.author,

        type: 'COMMUNITY_REPLY',

        title: 'New Reply to Your Question',

        body: `${req.user.name} replied to your community question.`,

        url: `/community?question=${question._id}`,
      });
    }
    await logAudit(req, {
      action: 'create', entity: 'answer',
      entityId: a._id, entityLabel: a.body,
    });
    res.status(201).json({
      answer: {
        id: a._id,
        body: a.body,
        author: { id: req.user._id, name: req.user.name, role: req.user.role },
        createdAt: a.createdAt,
      },
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to post answer' });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found' });

    await Answer.deleteMany({ question: question._id });
    await question.deleteOne();

    await logAudit(req, {
      action: 'delete', entity: 'question',
      entityId: question._id, entityLabel: question.title,
    });
    res.json({ message: 'Question deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete question' });
  }
};

exports.deleteAnswer = async (req, res) => {
  try {
    const answer = await Answer.findById(req.params.id);
    if (!answer) return res.status(404).json({ message: 'Answer not found' });

    await answer.deleteOne();

    await logAudit(req, {
      action: 'delete', entity: 'answer',
      entityId: answer._id, entityLabel: answer.body,
    });
    res.json({ message: 'Answer deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete answer' });
  }
};
