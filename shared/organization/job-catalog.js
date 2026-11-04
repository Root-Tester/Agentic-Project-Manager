const COMMON = {
  People: ['HR manager', 'HR specialist', 'Recruiter'],
  Operations: ['Operations manager', 'Operations specialist'],
  Finance: ['Finance manager', 'Accountant'],
  Sales: ['Sales manager', 'Sales representative'],
  Support: ['Support manager', 'Customer support specialist'],
  Administration: ['Office administrator']
};

const CATALOGS = {
  'service-based': {
    ...COMMON,
    Delivery: ['Delivery manager', 'Service delivery specialist', 'Consultant'],
    Engineering: ['Software developer', 'QA engineer', 'Systems engineer'],
    Design: ['Product designer', 'UX researcher'],
    Data: ['Data analyst', 'Data scientist']
  },
  'product-based': {
    ...COMMON,
    Product: ['Product manager', 'Product analyst'],
    Engineering: ['Backend developer', 'Frontend developer', 'Mobile developer', 'QA engineer'],
    Design: ['Product designer', 'UX researcher'],
    Data: ['Data analyst', 'Data scientist', 'Machine learning engineer'],
    Marketing: ['Marketing manager', 'Content specialist']
  },
  technology: {
    ...COMMON,
    Engineering: ['Backend developer', 'Frontend developer', 'Full-stack developer', 'QA engineer'],
    Security: ['Cybersecurity analyst', 'Security engineer'],
    IT: ['System administrator', 'Database administrator', 'IT support specialist'],
    Data: ['Data analyst', 'Data scientist', 'Machine learning engineer'],
    Product: ['Product manager', 'Product designer']
  },
  'non-technology': {
    ...COMMON,
    'Human Resources': ['HR manager', 'HR specialist', 'Recruiter'],
    Service: ['Service manager', 'Service specialist'],
    Production: ['Production manager', 'Production operator'],
    Logistics: ['Logistics manager', 'Logistics coordinator'],
    Marketing: ['Marketing manager', 'Marketing specialist']
  }
};

export const COMPANY_TYPES = [
  { id: 'service-based', label: 'Service-based' },
  { id: 'product-based', label: 'Product-based' },
  { id: 'technology', label: 'Technology' },
  { id: 'non-technology', label: 'Non-technology' }
];

export const COMPANY_ACCESS_ROLES = [
  { id: 'employee', label: 'Employee' },
  { id: 'team-leader', label: 'Team leader' },
  { id: 'manager', label: 'Manager' },
  { id: 'hr', label: 'HR' },
  { id: 'hr-manager', label: 'HR manager' }
];

export function getJobCatalog(companyType) {
  const departments = CATALOGS[companyType];
  if (!departments) return null;
  return Object.entries(departments).map(([department, titles]) => ({
    department,
    titles: [...new Set(titles)]
  }));
}
