#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 数据库文件路径
const DB_PATHS = [
    path.join(__dirname, 'auth.db'),
    path.join(__dirname, 'claude-code.db'),
    path.join(__dirname, '..', 'claude-code.db')
];

// 清空单个数据库
function clearDatabase(dbPath) {
    console.log(`清空数据库: ${dbPath}`);
    
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
        
        // 禁用外键约束
        db.pragma('foreign_keys = OFF');
        
        // 清空每个表
        for (const table of tables) {
            const result = db.prepare(`DELETE FROM ${table.name}`).run();
            console.log(`  清空表 ${table.name}: 删除了 ${result.changes} 行`);
        }
        
        // 重置自增ID
        db.prepare('DELETE FROM sqlite_sequence').run();
        
        // 执行VACUUM优化数据库
        db.prepare('VACUUM').run();
        
        // 重新启用外键约束
        db.pragma('foreign_keys = ON');
        db.close();
        
        console.log(`  完成！`);
    } catch (error) {
        console.error(`  错误: ${error.message}`);
    }
}

// 主函数
function main() {
    console.log('=== 快速清空 SQLite 数据库 ===\n');
    
    // 清空所有数据库
    for (const dbPath of DB_PATHS) {
        clearDatabase(dbPath);
    }
    
    console.log('\n所有操作完成！');
}

// 运行主函数
main();