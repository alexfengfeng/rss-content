/**
 * News to WeChat - 前端应用脚本
 */

// 显示 Toast 通知
function showToast(message, type = 'success') {
  const container = document.querySelector('.toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `alert alert-${type}`;
  toast.style.cssText = `
    padding: 1rem 1.5rem;
    margin-bottom: 0.5rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    animation: slideIn 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-width: 300px;
    max-width: 400px;
  `;
  
  // 设置颜色
  const colors = {
    success: { bg: '#d1fae5', border: '#a7f3d0', text: '#065f46' },
    info: { bg: '#dbeafe', border: '#bfdbfe', text: '#1e40af' },
    warning: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
    danger: { bg: '#fee2e2', border: '#fecaca', text: '#991b1b' }
  };
  
  const color = colors[type] || colors.success;
  toast.style.backgroundColor = color.bg;
  toast.style.border = `1px solid ${color.border}`;
  toast.style.color = color.text;
  
  toast.innerHTML = `
    <span>${message}</span>
    <button type="button" style="
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      color: inherit;
      opacity: 0.5;
      padding: 0;
      line-height: 1;
    " onclick="this.parentElement.remove()">&times;</button>
  `;
  
  container.appendChild(toast);
  
  // 自动移除
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// API 请求封装
async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || '请求失败');
    }
    
    return data;
  } catch (error) {
    showToast(error.message, 'danger');
    throw error;
  }
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
  // 自动隐藏 alert
  document.querySelectorAll('.alert-dismissible').forEach(alert => {
    setTimeout(() => {
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 300);
    }, 5000);
  });
  
  // 确认删除
  document.querySelectorAll('[data-confirm]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const message = this.dataset.confirm;
      if (!confirm(message)) {
        e.preventDefault();
      }
    });
  });
});
