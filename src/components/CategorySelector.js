import React from 'react';

const CategorySelector = ({ onFilterChange, currentFilter }) => {
  const categories = [
    { value: 'all', label: 'All' },
    { value: 'read', label: 'Finished' },
    { value: 'currently reading', label: 'Currently reading' },
    { value: 'unread', label: "Didn't finish" },
    { value: 'wishlist', label: 'Wishlist' }
  ];
  const activeIndex = Math.max(categories.findIndex((category) => category.value === currentFilter), 0);

  return (
    <div
      className="category-slider mb-4"
      style={{ '--category-count': categories.length, '--category-index': activeIndex }}
      role="tablist"
      aria-label="Book categories"
    >
      <span className="category-slider-pill" />
      {categories.map(category => (
        <button
          key={category.value}
          type="button"
          className={`category-btn ${currentFilter === category.value ? 'active' : ''}`}
          onClick={() => onFilterChange(category.value)}
          role="tab"
          aria-selected={currentFilter === category.value}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
};

export default CategorySelector;
