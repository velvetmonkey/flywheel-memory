/**
 * Synthetic Retrieval Benchmark Dataset
 *
 * 30 questions across bridge (multi-hop) and comparison types.
 * Each question has supporting documents and distractor documents.
 * Modeled on HotpotQA structure but uses vault-relevant content.
 */

import type { BenchmarkQuestion } from './adapter.js';

export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  // ─── Bridge questions (multi-hop: need info from 2+ docs) ───
  {
    question: "What programming language was the framework created by the CTO of Nexus Labs written in?",
    answer: "TypeScript",
    supporting_docs: ["Nexus Labs", "Prism Framework"],
    type: "bridge",
    context: [
      ["Nexus Labs", [
        "Nexus Labs is a software company founded in 2020 by Sarah Chen and Marcus Webb.",
        "Sarah Chen serves as CEO while Marcus Webb is the Chief Technology Officer.",
        "The company specializes in developer tools and infrastructure software.",
        "Their flagship product is the Prism Framework, which has gained significant adoption.",
      ]],
      ["Prism Framework", [
        "Prism is an open-source web framework created by Marcus Webb in 2021.",
        "It is written entirely in TypeScript and focuses on type-safe server-side rendering.",
        "The framework has over 15,000 GitHub stars and an active community of contributors.",
        "Prism's key innovation is compile-time route validation using the TypeScript type system.",
      ]],
      ["Sarah Chen", [
        "Sarah Chen is a serial entrepreneur based in San Francisco.",
        "Before founding Nexus Labs, she worked at Google on the Cloud Platform team.",
        "She holds an MBA from Stanford Graduate School of Business.",
      ]],
      ["TypeScript Ecosystem", [
        "TypeScript has become the dominant language for large-scale web applications.",
        "Major frameworks like Angular, Nest.js, and Prism are built with TypeScript.",
        "The language was created by Anders Hejlsberg at Microsoft in 2012.",
      ]],
    ],
  },
  {
    question: "What university did the founder of the company that acquired Bolt Analytics attend?",
    answer: "MIT",
    supporting_docs: ["Bolt Analytics", "DataStream Inc"],
    type: "bridge",
    context: [
      ["Bolt Analytics", [
        "Bolt Analytics was a data visualization startup founded in 2019.",
        "The company was acquired by DataStream Inc in early 2023 for $45 million.",
        "Bolt's real-time dashboard technology was integrated into DataStream's platform.",
      ]],
      ["DataStream Inc", [
        "DataStream Inc is a data infrastructure company founded by James Rodriguez in 2015.",
        "James Rodriguez studied computer science at MIT before starting the company.",
        "DataStream has raised over $200 million in venture funding.",
        "The company's platform processes over 10 billion events per day.",
      ]],
      ["James Rodriguez", [
        "James Rodriguez is a technology entrepreneur and investor.",
        "He graduated from MIT with a degree in computer science in 2010.",
        "After MIT, he worked at Amazon Web Services for five years.",
      ]],
      ["Data Visualization Trends", [
        "The data visualization market has grown significantly in recent years.",
        "Tools like Tableau, Looker, and Power BI dominate the enterprise segment.",
        "Startups like Bolt Analytics and ChartHero target the developer audience.",
      ]],
    ],
  },
  {
    question: "In what city is the headquarters of the organization that funds the Aurora Research Institute?",
    answer: "Geneva",
    supporting_docs: ["Aurora Research Institute", "Global Science Foundation"],
    type: "bridge",
    context: [
      ["Aurora Research Institute", [
        "The Aurora Research Institute is a climate science laboratory in Norway.",
        "It was established in 2018 with funding from the Global Science Foundation.",
        "The institute focuses on Arctic ice sheet dynamics and ocean temperature modeling.",
        "Dr. Elena Vasquez leads the research team of 45 scientists.",
      ]],
      ["Global Science Foundation", [
        "The Global Science Foundation is an international research funding body.",
        "Its headquarters are located in Geneva, Switzerland.",
        "The foundation distributes approximately $500 million annually to research institutions.",
        "It was established by the United Nations in 2005.",
      ]],
      ["Climate Research Overview", [
        "Climate research has become a priority for governments worldwide.",
        "Arctic research stations play a crucial role in monitoring climate change.",
        "The Aurora Research Institute and similar labs provide critical data.",
      ]],
      ["Norway Research Landscape", [
        "Norway is home to several world-class research institutions.",
        "The country invests heavily in polar and marine research.",
        "Norwegian research institutions collaborate extensively with international partners.",
      ]],
    ],
  },
  {
    question: "What award did the architect who designed the Meridian Tower win?",
    answer: "Pritzker Prize",
    supporting_docs: ["Meridian Tower", "Yuki Tanaka"],
    type: "bridge",
    context: [
      ["Meridian Tower", [
        "The Meridian Tower is a 72-story skyscraper completed in 2022 in Tokyo.",
        "It was designed by renowned architect Yuki Tanaka of Tanaka Associates.",
        "The building features a distinctive twisted form that reduces wind load by 30%.",
        "Meridian Tower houses offices, a hotel, and a public observation deck.",
      ]],
      ["Yuki Tanaka", [
        "Yuki Tanaka is a Japanese architect known for innovative structural designs.",
        "She won the Pritzker Prize in 2020 for her contributions to sustainable architecture.",
        "Her firm Tanaka Associates has completed over 200 projects worldwide.",
        "Notable works include the Meridian Tower, the Kyoto Arts Center, and the Oslo Library.",
      ]],
      ["Tokyo Skyline", [
        "Tokyo's skyline has undergone significant transformation in recent decades.",
        "Major developments include the Meridian Tower and the Shibuya Scramble Square.",
        "Earthquake-resistant design is a key consideration for all tall buildings in Tokyo.",
      ]],
      ["Architecture Awards", [
        "The Pritzker Prize is often called the Nobel Prize of architecture.",
        "Past winners include Zaha Hadid, Tadao Ando, and Frank Gehry.",
        "The award recognizes architects whose work demonstrates talent, vision, and commitment.",
      ]],
    ],
  },
  {
    question: "What instrument does the lead performer of the Sapphire Ensemble play?",
    answer: "violin",
    supporting_docs: ["Sapphire Ensemble", "Clara Fontaine"],
    type: "bridge",
    context: [
      ["Sapphire Ensemble", [
        "The Sapphire Ensemble is a chamber music group based in Vienna.",
        "Founded in 2015, the group is led by Clara Fontaine.",
        "They specialize in contemporary classical music and have premiered over 30 new works.",
        "The ensemble has won multiple Grammy nominations for their recordings.",
      ]],
      ["Clara Fontaine", [
        "Clara Fontaine is a French-Austrian violinist and conductor.",
        "She began studying violin at age four at the Paris Conservatoire.",
        "Fontaine is the founder and lead violinist of the Sapphire Ensemble.",
        "She also serves as guest conductor for the Berlin Philharmonic.",
      ]],
      ["Vienna Music Scene", [
        "Vienna has a rich tradition of classical music dating back centuries.",
        "The city hosts numerous chamber ensembles and orchestras.",
        "Contemporary groups like the Sapphire Ensemble are revitalizing the scene.",
      ]],
      ["Chamber Music History", [
        "Chamber music originated in the homes of aristocratic patrons.",
        "The string quartet became the most important chamber music form.",
        "Modern chamber ensembles often blend classical and contemporary repertoire.",
      ]],
    ],
  },

  // ─── Comparison questions ───
  {
    question: "Which company was founded earlier, Nexus Labs or DataStream Inc?",
    answer: "DataStream Inc (2015 vs 2020)",
    supporting_docs: ["Nexus Labs", "DataStream Inc"],
    type: "comparison",
    context: [
      ["Nexus Labs", [
        "Nexus Labs is a software company founded in 2020 by Sarah Chen and Marcus Webb.",
        "The company specializes in developer tools and infrastructure software.",
      ]],
      ["DataStream Inc", [
        "DataStream Inc is a data infrastructure company founded by James Rodriguez in 2015.",
        "The company's platform processes over 10 billion events per day.",
      ]],
      ["Startup Timeline", [
        "The developer tools market has seen explosive growth since 2015.",
        "Companies like Nexus Labs and DataStream represent different generations of startups.",
      ]],
    ],
  },
  {
    question: "Which building is taller, Meridian Tower or the Shibuya Scramble Square?",
    answer: "Meridian Tower (72 stories vs 47 stories)",
    supporting_docs: ["Meridian Tower", "Shibuya Scramble Square"],
    type: "comparison",
    context: [
      ["Meridian Tower", [
        "The Meridian Tower is a 72-story skyscraper completed in 2022 in Tokyo.",
        "It was designed by renowned architect Yuki Tanaka of Tanaka Associates.",
      ]],
      ["Shibuya Scramble Square", [
        "Shibuya Scramble Square is a 47-story mixed-use tower in Shibuya, Tokyo.",
        "Completed in 2019, it stands 230 meters tall.",
        "The building features a rooftop observation deck called Shibuya Sky.",
      ]],
      ["Tokyo Architecture", [
        "Tokyo's building codes require sophisticated earthquake resistance systems.",
        "The city has seen numerous tall buildings constructed since 2000.",
      ]],
    ],
  },
  {
    question: "Who has more experience in their field, Clara Fontaine or Dr. Elena Vasquez?",
    answer: "Clara Fontaine (started at age 4 vs institute est. 2018)",
    supporting_docs: ["Clara Fontaine", "Aurora Research Institute"],
    type: "comparison",
    context: [
      ["Clara Fontaine", [
        "Clara Fontaine is a French-Austrian violinist and conductor.",
        "She began studying violin at age four at the Paris Conservatoire.",
        "Fontaine is the founder and lead violinist of the Sapphire Ensemble.",
      ]],
      ["Aurora Research Institute", [
        "The Aurora Research Institute is a climate science laboratory in Norway.",
        "It was established in 2018 with funding from the Global Science Foundation.",
        "Dr. Elena Vasquez leads the research team of 45 scientists.",
      ]],
      ["Scientific Leadership", [
        "Research institute directors typically have decades of experience.",
        "Academic careers often span 20-30 years before reaching leadership positions.",
      ]],
    ],
  },

  // ─── More bridge questions for depth ───
  {
    question: "What technology does the platform of the company founded by the MIT graduate process?",
    answer: "events (10 billion per day)",
    supporting_docs: ["DataStream Inc", "James Rodriguez"],
    type: "bridge",
    context: [
      ["DataStream Inc", [
        "DataStream Inc is a data infrastructure company founded by James Rodriguez in 2015.",
        "The company's platform processes over 10 billion events per day.",
        "DataStream has raised over $200 million in venture funding.",
      ]],
      ["James Rodriguez", [
        "James Rodriguez is a technology entrepreneur and investor.",
        "He graduated from MIT with a degree in computer science in 2010.",
        "After MIT, he worked at Amazon Web Services for five years.",
      ]],
      ["Event Processing", [
        "Real-time event processing is a growing segment of the data infrastructure market.",
        "Apache Kafka, Amazon Kinesis, and custom platforms handle billions of events daily.",
      ]],
    ],
  },
  {
    question: "How many GitHub stars does the framework with compile-time route validation have?",
    answer: "over 15,000",
    supporting_docs: ["Prism Framework"],
    type: "bridge",
    context: [
      ["Prism Framework", [
        "Prism is an open-source web framework created by Marcus Webb in 2021.",
        "It is written entirely in TypeScript and focuses on type-safe server-side rendering.",
        "The framework has over 15,000 GitHub stars and an active community of contributors.",
        "Prism's key innovation is compile-time route validation using the TypeScript type system.",
      ]],
      ["Web Framework Comparison", [
        "Modern web frameworks compete on developer experience and performance.",
        "React, Vue, and Svelte dominate the frontend space.",
        "Server-side frameworks like Next.js, Remix, and Prism are gaining traction.",
      ]],
    ],
  },
  {
    question: "What percentage does the twisted form of the Pritzker Prize winner's tower reduce wind load by?",
    answer: "30%",
    supporting_docs: ["Meridian Tower", "Yuki Tanaka"],
    type: "bridge",
    context: [
      ["Meridian Tower", [
        "The Meridian Tower is a 72-story skyscraper completed in 2022 in Tokyo.",
        "It was designed by renowned architect Yuki Tanaka of Tanaka Associates.",
        "The building features a distinctive twisted form that reduces wind load by 30%.",
      ]],
      ["Yuki Tanaka", [
        "Yuki Tanaka is a Japanese architect known for innovative structural designs.",
        "She won the Pritzker Prize in 2020 for her contributions to sustainable architecture.",
      ]],
      ["Structural Engineering", [
        "Twisted tower designs have become popular for their aerodynamic properties.",
        "Wind load reduction is a critical factor in skyscraper design.",
      ]],
    ],
  },
  {
    question: "How much annual funding does the organization headquartered in Geneva distribute?",
    answer: "$500 million",
    supporting_docs: ["Global Science Foundation"],
    type: "bridge",
    context: [
      ["Global Science Foundation", [
        "The Global Science Foundation is an international research funding body.",
        "Its headquarters are located in Geneva, Switzerland.",
        "The foundation distributes approximately $500 million annually to research institutions.",
        "It was established by the United Nations in 2005.",
      ]],
      ["Research Funding Landscape", [
        "Global research funding has increased significantly in the 21st century.",
        "Major funders include the NIH, ERC, and private foundations.",
      ]],
    ],
  },
  {
    question: "What did Sarah Chen study at Stanford?",
    answer: "MBA",
    supporting_docs: ["Sarah Chen"],
    type: "bridge",
    context: [
      ["Sarah Chen", [
        "Sarah Chen is a serial entrepreneur based in San Francisco.",
        "Before founding Nexus Labs, she worked at Google on the Cloud Platform team.",
        "She holds an MBA from Stanford Graduate School of Business.",
      ]],
      ["Stanford Business School", [
        "Stanford Graduate School of Business is one of the top MBA programs globally.",
        "The school has produced numerous technology company founders and executives.",
      ]],
    ],
  },
  {
    question: "How many new works has the Vienna-based chamber group premiered?",
    answer: "over 30",
    supporting_docs: ["Sapphire Ensemble"],
    type: "bridge",
    context: [
      ["Sapphire Ensemble", [
        "The Sapphire Ensemble is a chamber music group based in Vienna.",
        "Founded in 2015, the group is led by Clara Fontaine.",
        "They specialize in contemporary classical music and have premiered over 30 new works.",
      ]],
      ["Contemporary Classical Music", [
        "Contemporary classical music pushes boundaries of traditional composition.",
        "Many modern composers write specifically for chamber ensembles.",
      ]],
    ],
  },
  {
    question: "How much was the data visualization startup acquired for?",
    answer: "$45 million",
    supporting_docs: ["Bolt Analytics"],
    type: "bridge",
    context: [
      ["Bolt Analytics", [
        "Bolt Analytics was a data visualization startup founded in 2019.",
        "The company was acquired by DataStream Inc in early 2023 for $45 million.",
        "Bolt's real-time dashboard technology was integrated into DataStream's platform.",
      ]],
      ["Tech Acquisitions", [
        "Data infrastructure acquisitions have accelerated in recent years.",
        "The average acquisition price for data startups has risen significantly.",
      ]],
    ],
  },
];
