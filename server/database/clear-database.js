#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// 数据库文件路径
const DB_PATHS = [
    path.join(__dirname, 'auth.db'),
    path.join(__dirname, 'claude-code.db'),
    path.join(__dirname, '..', 'claude-code.db')
];

// 创建命令行接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 询问用户确认
function askConfirmation(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

// 清空单个数据库
function clearDatabase(dbPath) {
    console.log(`\n正在处理数据库: ${dbPath}`);
    
    if (!fs.existsSync(dbPath)) {
        console.log(`  数据库文件不存在，跳过`);
        return;
    }

    try {
        const db = new Database(dbPath);
        
        // 获取所有表名
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all();
        
        console.log(`  找到 ${tables.length} 个表:`, tables.map(t => t.name).join(', '));
        
        // 禁用外键约束
        db.pragma('foreign_keys = OFF');
        
        // 开始事务
        db.prepare('BEGIN').run();
        
        try {
            // 清空每个表
            for (const table of tables) {
                const result = db.prepare(`DELETE FROM ${table.name}`).run();
                console.log(`  已清空表 ${table.name}: 删除了 ${result.changes} 行`);
            }
            
            // 重置自增ID
            db.prepare('DELETE FROM sqlite_sequence').run();
            
            // 提交事务
            db.prepare('COMMIT').run();
            
            // 执行VACUUM优化数据库
            db.prepare('VACUUM').run();
            
            console.log(`  数据库已成功清空并优化`);
        } catch (error) {
            // 回滚事务
            db.prepare('ROLLBACK').run();
            throw error;
        } finally {
            // 重新启用外键约束
            db.pragma('foreign_keys = ON');
            db.close();
        }
    } catch (error) {
        console.error(`  清空数据库时出错: ${error.message}`);
    }
}

// 主函数
async function main() {
    console.log('=== SQLite 数据库清空工具 ===\n');
    console.log('警告: 此操作将删除以下数据库中的所有数据:');
    DB_PATHS.forEach(p => console.log(`  - ${p}`));
    console.log('\n此操作不可恢复！\n');
    
    const confirmed = await askConfirmation('确定要继续吗? (y/n): ');
    
    if (!confirmed) {
        console.log('\n操作已取消');
        rl.close();
        return;
    }
    
    // 二次确认
    const doubleConfirmed = await askConfirmation('\n请再次确认，输入 y 继续清空所有数据: ');
    
    if (!doubleConfirmed) {
        console.log('\n操作已取消');
        rl.close();
        return;
    }
    
    console.log('\n开始清空数据库...');
    
    // 清空所有数据库
    for (const dbPath of DB_PATHS) {
        clearDatabase(dbPath);
    }
    
    console.log('\n所有操作完成！');
    rl.close();
}

// 运行主函数
main().catch(error => {
    console.error('发生错误:', error);
    rl.close();
    process.exit(1);
});