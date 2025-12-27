/**
 * Registration Page Component
 * 
 * Handles new user registration for teachers and guardians
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Eye, EyeOff, Mail, Lock, Phone, AlertCircle, UserPlus } from 'lucide-react';

const RegisterPage = () => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'guardian', // Default to guardian
    phone: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
    // Clear field error when user edits that field
    if (fieldErrors?.[name]) {
      setFieldErrors((prev) => {
        const next = { ...(prev || {}) };
        delete next[name];
        return next;
      });
    }
    // Clear error when user starts typing
    if (error) setError('');
  };

  const normalizePhone = (raw = '') => {
    if (!raw || typeof raw !== 'string') return '';
    // Trim and remove common formatting characters while preserving leading +
    const trimmed = raw.trim();
    const hasPlus = trimmed.startsWith('+');
    const cleaned = trimmed.replace(/[\s().-]/g, '');
    return hasPlus ? `+${cleaned.replace(/^\+/, '')}` : cleaned.replace(/^\+/, '');
  };

  const validateForm = () => {
    const nextFieldErrors = {};

    if (!formData.firstName?.trim()) nextFieldErrors.firstName = 'First name is required.';
    if (!formData.lastName?.trim()) nextFieldErrors.lastName = 'Last name is required.';
    if (!formData.email?.trim()) nextFieldErrors.email = 'Email is required.';

    if (formData.password !== formData.confirmPassword) {
      nextFieldErrors.confirmPassword = 'Passwords do not match.';
    }
    if (formData.password.length < 6) {
      nextFieldErrors.password = 'Password must be at least 6 characters long.';
    }

    const hasErrors = Object.keys(nextFieldErrors).length > 0;
    if (hasErrors) {
      setFieldErrors(nextFieldErrors);
      setError('Please fix the highlighted fields and try again.');
      return false;
    }

    setFieldErrors({});
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    if (!validateForm()) {
      setLoading(false);
      return;
    }

    try {
      const registrationData = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        role: formData.role,
        phone: formData.phone,
        timezone: formData.timezone,
      };

      const result = await register(registrationData);
      
      if (result.success) {
        navigate('/dashboard');
      } else {
        const backendFieldErrors = result.fieldErrors;

        // Fallback: build a field map from express-validator errors array
        const derivedFieldErrors = {};
        if (!backendFieldErrors && Array.isArray(result.errors)) {
          for (const err of result.errors) {
            const field = err?.path || err?.param;
            if (!field) continue;
            if (!derivedFieldErrors[field]) derivedFieldErrors[field] = err.msg;
          }
        }

        const mergedFieldErrors = backendFieldErrors || (Object.keys(derivedFieldErrors).length ? derivedFieldErrors : null);
        if (mergedFieldErrors) setFieldErrors(mergedFieldErrors);

        setError(result.error || 'Registration failed. Please review the form and try again.');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-primary rounded-full flex items-center justify-center mb-4">
            <UserPlus className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold text-foreground">
            Create Account
          </h2>
          <p className="mt-2 text-muted-foreground">
            Join Waraqa platform
          </p>
        </div>

        {/* Registration Form */}
        <div className="bg-card rounded-lg shadow-lg p-8 border border-border">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-destructive text-sm">{error}</span>
              </div>
            )}

            {/* Role Selection */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-foreground mb-2">
                Account Type
              </label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-border rounded-md bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              >
                <option value="guardian">Guardian/Parent</option>
                <option value="teacher">Teacher</option>
                {/* Student registration is handled by guardian, so no student option here */}
              </select>
            </div>

            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-2">
                  First Name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  value={formData.firstName}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.firstName
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="John"
                />
                {fieldErrors.firstName && (
                  <p className="mt-1 text-xs text-destructive">{fieldErrors.firstName}</p>
                )}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-foreground mb-2">
                  Last Name
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  value={formData.lastName}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.lastName
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="Doe"
                />
                {fieldErrors.lastName && (
                  <p className="mt-1 text-xs text-destructive">{fieldErrors.lastName}</p>
                )}
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email Address
              </label>
              <div className="relative">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 pl-10 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.email
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="john.doe@example.com"
                />
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
              {fieldErrors.email && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.email}</p>
              )}
            </div>

            {/* Phone Field */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-foreground mb-2">
                Phone Number (Optional)
              </label>
              <div className="relative">
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  onBlur={() => setFormData((prev) => ({ ...prev, phone: normalizePhone(prev.phone) }))}
                  className={`w-full px-3 py-2 pl-10 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.phone
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="+1 (555) 123-4567"
                />
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
              {fieldErrors.phone ? (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.phone}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Tip: include country code (e.g., +966..., +1...).</p>
              )}
            </div>

            {/* Password Fields */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 pl-10 pr-10 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.password
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="Create a strong password"
                />
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {fieldErrors.password ? (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.password}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">At least 6 characters.</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 pl-10 pr-10 border rounded-md bg-input text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:border-transparent ${
                    fieldErrors.confirmPassword
                      ? 'border-destructive/40 focus:ring-destructive/20'
                      : 'border-border focus:ring-ring'
                  }`}
                  placeholder="Confirm your password"
                />
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-destructive">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-2 px-4 rounded-md font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin"></div>
                  <span>Creating Account...</span>
                </div>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Links */}
          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-primary hover:text-primary/80 text-sm font-medium"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground">
          <p>© 2024 Waraq Inc. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;


