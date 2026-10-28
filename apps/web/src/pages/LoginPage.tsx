import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Button } from '@pos/ui';
import { Building2, KeyRound, User, AlertCircle } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [pharmacyCode, setPharmacyCode] = useState(
    () => localStorage.getItem('pos_pharmacy_code') || ''
  );
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pharmacyCode.trim() || !name.trim() || !pin.trim()) {
      setError('Please provide pharmacy code, username and PIN.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await login(pharmacyCode.trim(), name.trim(), pin.trim());
      localStorage.setItem('pos_pharmacy_code', pharmacyCode.trim().toUpperCase());
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Please check credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-4">
      <div className="w-full max-w-md">
        {/* App Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 shadow-xl shadow-blue-500/25 mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            MediCare Portal
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Executive Owner &amp; Pharmacist Dashboard
          </p>
        </div>

        {/* Login Card */}
        <Card className="shadow-2xl border-slate-700/60 bg-white/95 backdrop-blur-sm">
          <form onSubmit={handleSubmit}>
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg font-bold text-slate-900">
                Sign In
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Enter your registered name and numeric PIN to access the portal.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-2">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  Pharmacy Code
                </label>
                <Input
                  type="text"
                  placeholder="e.g. DEV"
                  value={pharmacyCode}
                  onChange={(e) => setPharmacyCode(e.target.value.toUpperCase())}
                  disabled={isLoading}
                  autoFocus={!pharmacyCode}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Username / Staff Name
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Dr. Tariq (Owner)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  autoFocus={!!pharmacyCode}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  Numeric PIN
                </label>
                <Input
                  type="password"
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={isLoading}
                  maxLength={8}
                />
              </div>
            </CardContent>

            <CardFooter className="pt-2">
              <Button
                type="submit"
                className="w-full text-xs font-bold py-2.5 shadow-md shadow-blue-500/20"
                disabled={isLoading}
              >
                {isLoading ? 'Verifying Credentials...' : 'Authenticate & Enter'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Security Notice */}
        <p className="text-center text-[11px] text-slate-400 mt-6 font-medium">
          Role-based access strictly enforced • All activity is cryptographically logged
        </p>
      </div>
    </div>
  );
};
