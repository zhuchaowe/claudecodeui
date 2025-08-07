export const promptTemplates = [
  {
    id: 'project-init-understand',
    category: '🚀 项目初始化',
    title: '快速了解项目结构',
    content: '请阅读项目的 README.md、package.json 和主要目录，帮我了解这个项目的架构和技术栈，但暂时不要编写任何代码。'
  },
  {
    id: 'project-init-config',
    category: '🚀 项目初始化',
    title: '创建项目配置文件',
    content: '请帮我创建一个详细的 CLAUDE.md 文件，包含：\n\n- 项目架构说明\n- 常用命令\n- 代码规范\n- 开发环境配置'
  },
  {
    id: 'project-init-env',
    category: '🚀 项目初始化',
    title: '项目环境配置',
    content: '请检查项目的环境配置，确保所有依赖正确安装，并运行初始化脚本。\n\n如果有任何问题请告诉我如何解决。'
  },
  {
    id: 'feature-dev-flow',
    category: '🎯 功能开发',
    title: '新功能开发流程',
    content: '我需要开发 [功能描述]。请按照以下步骤：\n\n1. 先阅读相关代码了解现有架构\n2. 制定详细的实现计划\n3. 实现核心功能\n4. 编写测试\n5. 更新文档\n\n每完成一步都要暂停等待我确认。'
  },
  {
    id: 'feature-tdd',
    category: '🎯 功能开发',
    title: '测试驱动开发',
    content: '我要实现 [功能描述]。\n\n请先基于期望的输入输出编写测试用例，确保测试会失败，然后再实现功能代码使测试通过。'
  },
  {
    id: 'feature-api',
    category: '🎯 功能开发',
    title: 'API 接口开发',
    content: '请帮我设计和实现 [API 描述] 接口，包括：\n\n- 路由定义\n- 请求参数验证\n- 业务逻辑实现\n- 响应格式定义\n- 错误处理\n- API 文档'
  },
  {
    id: 'feature-component',
    category: '🎯 功能开发',
    title: '组件开发',
    content: '请帮我创建一个 [组件名称] 组件，要求：\n\n- 遵循项目现有的组件模式\n- 包含 TypeScript 类型定义\n- 支持 [具体功能需求]\n- 编写对应的测试文件'
  },
  {
    id: 'debug-error',
    category: '🔧 代码调试与优化',
    title: '错误诊断',
    content: '我遇到了这个错误：[错误信息]\n\n请帮我分析错误原因，并提供修复方案。如果需要查看相关代码，请告诉我。'
  },
  {
    id: 'debug-performance',
    category: '🔧 代码调试与优化',
    title: '性能优化',
    content: '请分析 [文件/功能] 的性能问题，并提供优化建议。\n\n重点关注：\n- 执行效率\n- 内存使用\n- 加载速度\n- 用户体验'
  },
  {
    id: 'debug-refactor',
    category: '🔧 代码调试与优化',
    title: '代码重构',
    content: '请重构 [文件名] 中的 [函数/类]，目标是：\n\n- 提高代码可读性\n- 减少重复代码\n- 遵循最佳实践\n- 保持功能不变\n\n请先分析现有代码，然后提供重构计划。'
  },
  {
    id: 'debug-review',
    category: '🔧 代码调试与优化',
    title: '代码审查',
    content: '请对 [文件/功能] 进行代码审查，重点检查：\n\n- 代码规范\n- 安全问题\n- 性能问题\n- 最佳实践\n- 潜在 bug'
  },
  {
    id: 'test-write',
    category: '🧪 测试相关',
    title: '测试用例编写',
    content: '请为 [函数/类/组件] 编写全面的测试用例，包括：\n\n- 正常情况测试\n- 边界条件测试\n- 错误情况测试\n- 模拟依赖项'
  },
  {
    id: 'test-fix',
    category: '🧪 测试相关',
    title: '测试修复',
    content: '有几个测试失败了，请分析失败原因并修复。\n\n运行测试命令是：[测试命令]'
  },
  {
    id: 'test-coverage',
    category: '🧪 测试相关',
    title: '测试覆盖率提升',
    content: '请分析当前的测试覆盖率，并为覆盖率不足的部分补充测试用例。'
  },
  {
    id: 'frontend-ui',
    category: '📱 前端开发',
    title: 'UI 组件实现',
    content: '请根据这个设计图实现 UI 组件：[上传设计图]\n\n要求：\n- 响应式设计\n- 支持深色模式\n- 无障碍性支持\n- 符合设计规范'
  },
  {
    id: 'frontend-style',
    category: '📱 前端开发',
    title: '样式调整',
    content: '请优化 [组件/页面] 的样式，实现以下效果：\n\n- [具体样式需求]\n- 保持与整体设计一致\n- 确保在不同设备上显示正常'
  },
  {
    id: 'frontend-state',
    category: '📱 前端开发',
    title: '状态管理',
    content: '请为 [功能] 实现状态管理，包括：\n\n- 状态结构设计\n- Action 定义\n- Reducer 实现\n- 异步操作处理'
  },
  {
    id: 'backend-db',
    category: '⚡ 后端开发',
    title: '数据库设计',
    content: '请为 [功能] 设计数据库表结构，包括：\n\n- 表结构定义\n- 索引设计\n- 关系约束\n- 迁移脚本'
  },
  {
    id: 'backend-middleware',
    category: '⚡ 后端开发',
    title: '中间件开发',
    content: '请实现一个 [中间件名称] 中间件，功能包括：\n\n- [具体功能需求]\n- 错误处理\n- 日志记录\n- 性能监控'
  },
  {
    id: 'backend-service',
    category: '⚡ 后端开发',
    title: '服务集成',
    content: '请帮我集成 [第三方服务]，包括：\n\n- SDK 配置\n- API 调用封装\n- 错误处理\n- 单元测试'
  },
  {
    id: 'docs-api',
    category: '📚 文档编写',
    title: 'API 文档生成',
    content: '请为项目生成 API 文档，包括：\n\n- 接口列表\n- 请求参数说明\n- 响应格式示例\n- 错误码说明'
  },
  {
    id: 'docs-comment',
    category: '📚 文档编写',
    title: '代码注释',
    content: '请为 [文件/函数] 添加详细的代码注释，包括：\n\n- 功能描述\n- 参数说明\n- 返回值说明\n- 使用示例'
  },
  {
    id: 'docs-readme',
    category: '📚 文档编写',
    title: 'README 更新',
    content: '请更新项目的 README.md 文件，确保包含：\n\n- 项目简介\n- 安装说明\n- 使用方法\n- 贡献指南'
  },
  {
    id: 'git-commit',
    category: '🔄 Git 工作流',
    title: '代码提交',
    content: '请查看当前的修改，编写合适的提交信息并提交代码。提交信息要遵循项目的提交规范。'
  },
  {
    id: 'git-pr',
    category: '🔄 Git 工作流',
    title: '创建 PR',
    content: '请创建一个 Pull Request，包括：\n\n- 清晰的标题和描述\n- 修改内容摘要\n- 测试计划\n- 相关 Issue 链接'
  },
  {
    id: 'git-branch',
    category: '🔄 Git 工作流',
    title: '分支管理',
    content: '请帮我创建一个新的功能分支 [分支名称]，并切换到该分支开始开发。'
  },
  {
    id: 'pm-task',
    category: '🗂️ 项目管理',
    title: '任务分解',
    content: '我需要实现 [大功能描述]。请帮我分解成多个小任务，每个任务包括：\n\n- 任务描述\n- 预估工时\n- 依赖关系\n- 验收标准'
  },
  {
    id: 'pm-plan',
    category: '🗂️ 项目管理',
    title: '项目规划',
    content: '请帮我制定项目开发计划，包括：\n\n- 功能模块划分\n- 开发优先级\n- 时间安排\n- 风险评估'
  },
  {
    id: 'pm-tech',
    category: '🗂️ 项目管理',
    title: '技术选型',
    content: '对于 [项目需求]，请帮我分析技术选型，比较不同方案的优缺点，并推荐最适合的技术栈。'
  },
  {
    id: 'analysis-deps',
    category: '🔍 代码分析',
    title: '依赖分析',
    content: '请分析项目的依赖关系，检查：\n\n- 是否有冗余依赖\n- 是否有安全漏洞\n- 是否需要更新版本\n- 是否有替代方案'
  },
  {
    id: 'analysis-arch',
    category: '🔍 代码分析',
    title: '架构分析',
    content: '请分析项目的整体架构，评估：\n\n- 模块职责是否清晰\n- 耦合度是否合理\n- 扩展性如何\n- 有哪些改进空间'
  },
  {
    id: 'analysis-stats',
    category: '🔍 代码分析',
    title: '代码统计',
    content: '请统计项目的代码情况，包括：\n\n- 代码行数\n- 文件数量\n- 技术栈分布\n- 测试覆盖率'
  },
  {
    id: 'analysis-log',
    category: '🔍 代码分析',
    title: '日志分析',
    content: '请帮我根据日志打印代码和日志检索工具，进行综合分析，解决下面的问题：\n[描述你的需求]\n\n环境：[onprem/dev/prod]\n服务：[parser/mygpt/file-parser] \n时间范围：[YYYY-MM-DD HH:MM:SS] 到 [YYYY-MM-DD HH:MM:SS]\nTraceId: [traceid]'
  },
  {
    id: 'env-dev',
    category: '🛠️ 环境配置',
    title: '开发环境搭建',
    content: '请帮我配置开发环境，包括：\n\n- 安装必要的依赖\n- 配置环境变量\n- 设置开发工具\n- 验证环境是否正常'
  },
  {
    id: 'env-cicd',
    category: '🛠️ 环境配置',
    title: 'CI/CD 配置',
    content: '请为项目配置 CI/CD 流程，包括：\n\n- 自动化测试\n- 代码质量检查\n- 自动部署\n- 通知机制'
  },
  {
    id: 'env-docker',
    category: '🛠️ 环境配置',
    title: 'Docker 配置',
    content: '请为项目创建 Docker 配置，包括：\n\n- Dockerfile\n- docker-compose.yml\n- 环境变量配置\n- 部署说明'
  },
  {
    id: 'advanced-batch',
    category: '💡 高级技巧',
    title: '批量处理',
    content: '请对项目中所有的 [文件类型] 文件执行 [操作]，确保：\n\n- 操作的一致性\n- 不破坏现有功能\n- 符合项目规范'
  },
  {
    id: 'advanced-script',
    category: '💡 高级技巧',
    title: '自动化脚本',
    content: '请创建一个自动化脚本来 [任务描述]，脚本应该：\n\n- 支持命令行参数\n- 包含错误处理\n- 提供详细日志\n- 易于维护'
  },
  {
    id: 'advanced-codegen',
    category: '💡 高级技巧',
    title: '代码生成',
    content: '请根据 [配置/模板] 生成相应的代码文件，包括：\n\n- [具体文件类型]\n- 遵循项目约定\n- 包含必要注释\n- 通过基本测试'
  }
];

export const getTemplatesByCategory = () => {
  const templatesByCategory = {};
  promptTemplates.forEach(template => {
    if (!templatesByCategory[template.category]) {
      templatesByCategory[template.category] = [];
    }
    templatesByCategory[template.category].push(template);
  });
  return templatesByCategory;
};

export const searchTemplates = (query) => {
  if (!query.trim()) return promptTemplates;
  
  const lowerQuery = query.toLowerCase();
  return promptTemplates.filter(template =>
    template.title.toLowerCase().includes(lowerQuery) ||
    template.content.toLowerCase().includes(lowerQuery) ||
    template.category.toLowerCase().includes(lowerQuery)
  );
};