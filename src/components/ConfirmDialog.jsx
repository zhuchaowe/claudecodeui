import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

function ConfirmDialog({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning' // 'warning', 'danger', 'info'
}) {
  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />,
          iconBg: 'bg-red-100 dark:bg-red-900/20',
          confirmButton: 'bg-red-600 hover:bg-red-700 text-white'
        };
      case 'info':
        return {
          icon: <Info className="w-6 h-6 text-blue-600 dark:text-blue-400" />,
          iconBg: 'bg-blue-100 dark:bg-blue-900/20',
          confirmButton: 'bg-blue-600 hover:bg-blue-700 text-white'
        };
      case 'warning':
      default:
        return {
          icon: <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />,
          iconBg: 'bg-yellow-100 dark:bg-yellow-900/20',
          confirmButton: 'bg-yellow-600 hover:bg-yellow-700 text-white'
        };
    }
  };

  const styles = getVariantStyles();

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transform transition-all">
        <div className="p-6">
          <div className="flex items-start">
            <div className={`flex-shrink-0 w-12 h-12 rounded-full ${styles.iconBg} flex items-center justify-center`}>
              {styles.icon}
            </div>
            <div className="ml-4 flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {message}
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
            </button>
          </div>
          
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className={`px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${styles.confirmButton}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;