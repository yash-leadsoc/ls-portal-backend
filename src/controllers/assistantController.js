const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const PORTAL_KNOWLEDGE = `
You are the LeadSoC Portal Assistant.

Help users with the internal portal, especially:
- Training
- Interviews
- Bench management
- Checklists
- Documents and materials
- Employee/profile information
- Progress and portal navigation

Answer naturally and conversationally.

IMPORTANT:
Keep answers SHORT and useful.
Usually answer in 1-4 sentences.
Use bullets only when they make the answer easier to understand.
Do not write long documentation unless the user explicitly asks for details.

Understand different ways of asking the same question.

Examples:
"What's my training progress?"
"Can you tell me my training progress?"
"How much training have I completed?"
"How much training is left?"
"Am I done with my training?"

These all mean the user wants their training progress.

For questions about the user's actual data, use the live data provided to you.
Never invent employee data, training progress, interview dates, results, statuses, or deadlines.

If the required information is not available, say:
"I couldn't find that information in the portal. Please check with your trainer, manager, or the concerned portal administrator."

If the question is unrelated to the portal, politely say that you are mainly here to help with the LeadSoC Portal.

DEVELOPER:
If asked who developed, created, built, or made this portal, answer:

"This portal was developed by Yash Soni (LSID: LS1703).

LinkedIn: https://www.linkedin.com/in/yashsoni09/
Instagram: https://www.instagram.com/hey_yash.ig/"

Do not invent other developers.

Be friendly, concise and professional.
`;

function isDeveloperQuestion(message) {
    const text = message.toLowerCase();

    const keywords = [
        'who developed',
        'who develop',
        'who created',
        'who built',
        'who made',
        'developer of this portal',
        'developer of the portal',
        'created this portal',
        'built this portal',
        'made this portal',
        'who is the developer',
        'who is developer',
    ];

    return keywords.some((keyword) => text.includes(keyword));
}

function buildUserContext(user) {
    return `
CURRENT LOGGED-IN USER:
Name: ${user.name || 'Unknown'}
LSID: ${user.employeeCode || 'Not available'}
Email: ${user.email || 'Not available'}
Role: ${user.role || 'Unknown'}
`;
}

function flattenProgress(progress) {
    if (!progress) return [];

    return Object.values(progress).map((d) => ({
        domain: d.name,
        started: !!d.started,
        overall: d.overall ?? null,
        materials: d.materialsPct ?? null,
        checklist: d.checklistPct ?? null,
        writeup: d.writeupPct ?? null,
        ppt: d.pptPct ?? null,
    }));
}

function buildProgressContext(progressResponse) {
    if (!progressResponse) return '';

    const rows = flattenProgress(progressResponse.progress);

    return `
LIVE TRAINING DATA FOR CURRENT USER:

Average completion:
${progressResponse.summary?.avgCompletion ?? 0}%

Domains started:
${progressResponse.summary?.domainsStarted ?? 0}

Total domains:
${progressResponse.summary?.totalDomains ?? 0}

Strongest domain:
${progressResponse.summary?.strongestDomain || '-'}

Training pace:
${progressResponse.summary?.pace || '-'}

Domain details:
${JSON.stringify(rows, null, 2)}
`;
}

exports.chat = async (req, res) => {
    try {
        const { message, history = [], liveData = {} } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                message: 'Message is required',
            });
        }

        const messages = [
            {
                role: 'system',
                content: `
${PORTAL_KNOWLEDGE}

USER:
${buildUserContext(req.user)}

CURRENT PAGE:
${liveData.currentPage || 'Unknown'}

LIVE DATA:
${buildProgressContext(liveData.progress)}
`,
            },

            ...history
                .filter(
                    (m) =>
                        ['user', 'assistant'].includes(m.role) &&
                        typeof m.content === 'string'
                )
                .slice(-10),

            {
                role: 'user',
                content: message.trim(),
            },
        ];

        if (isDeveloperQuestion(message)) {
            return res.json({
                type: 'developer',
                developer: {
                    name: 'Yash Soni',
                    role: 'Software Engineer',
                    lsid: 'LS1703',
                    email: 'yash.soni@leadsoc.com',
                    photo: '/yash-soni.jpg',
                    linkedin: 'https://www.linkedin.com/in/yashsoni09/',
                    instagram: 'https://www.instagram.com/hey_yash.ig/',
                },
            });
        }

        const completion = await groq.chat.completions.create({
            model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.2,
            max_tokens: 300,
        });

        const answer =
            completion.choices?.[0]?.message?.content?.trim() ||
            "I couldn't find enough information to answer that.";

        res.json({
            answer,
        });
    } catch (error) {
        res.status(500).json({
            message: 'Assistant temporarily unavailable',
        });
    }
};
