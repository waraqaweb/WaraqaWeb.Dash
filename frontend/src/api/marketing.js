import api from './axios';

export const getSiteSettings = async () => {
  const { data } = await api.get('/marketing/site-settings');
  return data;
};

export const updateSiteSettings = async (payload) => {
  const { data } = await api.put('/marketing/site-settings', payload);
  return data;
};

export const getLandingPages = async () => {
  const { data } = await api.get('/marketing/admin/landing-pages');
  return data.pages || [];
};

export const getLandingPage = async (slug) => {
  const { data } = await api.get(`/marketing/admin/landing-pages/${slug}`);
  return data;
};

export const createLandingPage = async (payload) => {
  const { data } = await api.post('/marketing/landing-pages', payload);
  return data;
};

export const updateLandingPage = async (pageId, payload) => {
  const { data } = await api.put(`/marketing/landing-pages/${pageId}`, payload);
  return data;
};

export const publishLandingPage = async (pageId) => {
  const { data } = await api.post(`/marketing/landing-pages/${pageId}/publish`);
  return data;
};

export const getAdminCourses = async () => {
  const { data } = await api.get('/marketing/admin/courses');
  return data.courses || [];
};

export const createCourse = async (payload) => {
  const { data } = await api.post('/marketing/courses', payload);
  return data;
};

export const updateCourse = async (courseId, payload) => {
  const { data } = await api.put(`/marketing/courses/${courseId}`, payload);
  return data;
};

export const deleteCourse = async (courseId) => {
  await api.delete(`/marketing/courses/${courseId}`);
  return true;
};

export const getAdminPricingPlans = async () => {
  const { data } = await api.get('/marketing/admin/pricing');
  return data.plans || [];
};

export const createPricingPlan = async (payload) => {
  const { data } = await api.post('/marketing/pricing', payload);
  return data;
};

export const updatePricingPlan = async (planId, payload) => {
  const { data } = await api.put(`/marketing/pricing/${planId}`, payload);
  return data;
};

export const deletePricingPlan = async (planId) => {
  await api.delete(`/marketing/pricing/${planId}`);
  return true;
};

export const getAdminTeachers = async () => {
  const { data } = await api.get('/marketing/admin/teachers');
  return data.teachers || [];
};

export const createTeacherProfile = async (payload) => {
  const { data } = await api.post('/marketing/teachers', payload);
  return data;
};

export const updateTeacherProfile = async (teacherId, payload) => {
  const { data } = await api.put(`/marketing/teachers/${teacherId}`, payload);
  return data;
};

export const deleteTeacherProfile = async (teacherId) => {
  await api.delete(`/marketing/teachers/${teacherId}`);
  return true;
};

export const getAdminTestimonials = async () => {
  const { data } = await api.get('/marketing/admin/testimonials');
  return data.testimonials || [];
};

export const createTestimonial = async (payload) => {
  const { data } = await api.post('/marketing/testimonials', payload);
  return data;
};

export const updateTestimonial = async (testimonialId, payload) => {
  const { data } = await api.put(`/marketing/testimonials/${testimonialId}`, payload);
  return data;
};

export const deleteTestimonial = async (testimonialId) => {
  await api.delete(`/marketing/testimonials/${testimonialId}`);
  return true;
};

export const getAdminBlogPosts = async () => {
  const { data } = await api.get('/marketing/admin/blog');
  return data.posts || [];
};

export const createBlogPost = async (payload) => {
  const { data } = await api.post('/marketing/blog', payload);
  return data;
};

export const updateBlogPost = async (postId, payload) => {
  const { data } = await api.put(`/marketing/blog/${postId}`, payload);
  return data;
};

export const deleteBlogPost = async (postId) => {
  await api.delete(`/marketing/blog/${postId}`);
  return true;
};

export const getMediaAssets = async (params = {}) => {
  const { data } = await api.get('/marketing/media', { params });
  return data.assets || [];
};

export const uploadMediaAsset = async ({ file, tags, altText, attribution }) => {
  if (!file) throw new Error('File is required');
  const formData = new FormData();
  formData.append('file', file);
  if (tags) {
    const tagString = Array.isArray(tags) ? tags.join(',') : tags;
    if (tagString) formData.append('tags', tagString);
  }
  if (altText) formData.append('altText', altText);
  if (attribution) formData.append('attribution', attribution);
  const { data } = await api.post('/marketing/media', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
};

export default {
  getSiteSettings,
  updateSiteSettings,
  getLandingPages,
  getLandingPage,
  createLandingPage,
  updateLandingPage,
  publishLandingPage,
  getAdminCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getAdminPricingPlans,
  createPricingPlan,
  updatePricingPlan,
  deletePricingPlan,
  getAdminTeachers,
  createTeacherProfile,
  updateTeacherProfile,
  deleteTeacherProfile,
  getAdminTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  getAdminBlogPosts,
  getMediaAssets,
  uploadMediaAsset
};
