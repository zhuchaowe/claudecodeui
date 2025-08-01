import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Clock, Circle, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from './ui/badge';

const FloatingTodoList = ({ todos, onClose, isVisible }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Auto-hide when all todos are completed
  useEffect(() => {
    if (todos && todos.length > 0) {
      const allCompleted = todos.every(todo => todo.status === 'completed');
      if (allCompleted) {
        // Delay hiding to show the completed state
        const timer = setTimeout(() => {
          setIsClosing(true);
          setTimeout(() => {
            onClose();
          }, 300);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [todos, onClose]);

  if (!todos || todos.length === 0 || !isVisible) {
    return null;
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500 dark:text-green-400" />;
      case 'in_progress':
        return <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" />;
      case 'pending':
      default:
        return <Circle className="w-4 h-4 text-gray-400 dark:text-gray-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'in_progress':
        return 'text-blue-600 dark:text-blue-400';
      case 'pending':
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getPriorityBadgeColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300';
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
      case 'low':
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
    }
  };

  const completedCount = todos.filter(todo => todo.status === 'completed').length;
  const inProgressCount = todos.filter(todo => todo.status === 'in_progress').length;
  const progress = (completedCount / todos.length) * 100;

  return (
    <div 
      className={`fixed bottom-20 right-4 sm:bottom-8 sm:right-8 z-50 transition-all duration-300 ${
        isClosing ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 w-80 sm:w-96 max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 dark:text-white">Claude's Tasks</h3>
              <Badge variant="outline" className="text-xs">
                {completedCount}/{todos.length}
              </Badge>
              {inProgressCount > 0 && (
                <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  {inProgressCount} active
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label={isMinimized ? "Expand" : "Minimize"}
              >
                {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <button
                onClick={() => {
                  setIsClosing(true);
                  setTimeout(() => onClose(), 300);
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Task list */}
        {!isMinimized && (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {todos.map((todo, index) => (
              <div
                key={todo.id}
                className={`flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md transition-all duration-300 ${
                  todo.status === 'completed' ? 'opacity-60' : ''
                }`}
                style={{
                  animationDelay: `${index * 50}ms`,
                  animation: 'slideIn 0.3s ease-out'
                }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getStatusIcon(todo.status)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${
                    todo.status === 'completed' 
                      ? 'line-through text-gray-500 dark:text-gray-400' 
                      : getStatusColor(todo.status)
                  }`}>
                    {todo.content}
                  </p>
                  
                  {todo.priority && todo.priority !== 'medium' && (
                    <Badge
                      variant="outline"
                      className={`text-xs mt-1 ${getPriorityBadgeColor(todo.priority)}`}
                    >
                      {todo.priority}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default FloatingTodoList;