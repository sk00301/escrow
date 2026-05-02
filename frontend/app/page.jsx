'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { Navbar } from '@/components/navbar';
import { WalletModal } from '@/components/wallet-modal';
import { useWallet } from '@/contexts/wallet-context';
import { useLivePlatformStats } from '@/hooks/use-live-platform-stats';
import { Shield, Brain, Users, FileCheck, Wallet, Lock, CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
const AEGISTRA_LOGO = '/Aegistra%20Logo.png';
export default function LandingPage() {
    const [walletModalOpen, setWalletModalOpen] = useState(false);
    const { isConnected, provider, isCorrectNetwork } = useWallet();
    const { stats: platformStats, loading: statsLoading } = useLivePlatformStats({
        provider: isCorrectNetwork ? provider : null,
    });
    const currentYear = new Date().getFullYear();
    return (<div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden particles-bg">
        {/* Animated Grid Background */}
        <div className="absolute inset-0 grid-bg opacity-30"/>
        
        {/* Floating Elements */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/5 rounded-full blur-3xl animate-float"/>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }}/>
        
        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-border mb-8">
              <Sparkles className="h-4 w-4 text-primary"/>
              <span className="text-sm text-muted-foreground">Powered by Smart Contracts</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="gradient-text">Decentralized</span>
              <br />
              <span className="text-foreground">Freelance Escrow</span>
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Secure, transparent, and AI-verified freelance payments. 
              No middlemen. No disputes. Just fair, automated settlements.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {isConnected ? (<Link href="/client">
                  <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 cyan-glow gap-2 px-8 h-14 text-lg">
                    Launch App
                    <ArrowRight className="h-5 w-5"/>
                  </Button>
                </Link>) : (<Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 cyan-glow gap-2 px-8 h-14 text-lg" onClick={() => setWalletModalOpen(true)}>
                  <Wallet className="h-5 w-5"/>
                  Connect Wallet
                </Button>)}
              <Button size="lg" variant="outline" className="border-border bg-muted/30 hover:bg-muted/50 gap-2 px-8 h-14 text-lg">
                Learn More
              </Button>
            </div>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-2">
            <div className="w-1 h-2 bg-primary rounded-full animate-pulse"/>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16 animate-slide-in-up">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Why Choose Aegistra?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Built on blockchain technology with AI-powered verification for the future of freelance work.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
            {
                icon: Shield,
                title: 'Smart Contracts',
                description: 'Funds are locked in secure escrow contracts. No party can access them until conditions are met.'
            },
            {
                icon: Brain,
                title: 'AI Verification',
                description: 'Automated deliverable verification using AI. Test pass rates, code coverage, and quality metrics.'
            },
            {
                icon: Users,
                title: 'Jury Resolution',
                description: 'Decentralized dispute resolution by staked jurors. Fair, transparent, and community-driven.'
            }
        ].map((feature, index) => (<div key={feature.title} className="glass-card rounded-2xl p-8 border border-border hover:border-primary/50 transition-all duration-300 hover:-translate-y-1 group" style={{ animationDelay: `${index * 0.1}s` }}>
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:cyan-glow transition-all duration-300">
                  <feature.icon className="h-7 w-7 text-primary"/>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 glass border-y border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
            {
                label: 'Total Contracts',
                value: statsLoading ? '...' : platformStats.totalContracts.toLocaleString(),
                suffix: '',
            },
            {
                label: 'Total Paid Out',
                value: statsLoading ? '...' : platformStats.totalPaidOut.toFixed(4),
                suffix: ' ETH',
            },
            {
                label: 'Disputes Resolved',
                value: statsLoading ? '...' : platformStats.disputesResolved.toLocaleString(),
                suffix: '',
            },
            {
                label: 'Active Jurors',
                value: statsLoading ? '...' : platformStats.activeJurors.toLocaleString(),
                suffix: '',
            }
        ].map((stat) => (<div key={stat.label} className="text-center">
                <p className="text-3xl sm:text-4xl font-bold text-foreground mb-1">
                  {stat.value}
                  <span className="text-primary">{stat.suffix}</span>
                </p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Four simple steps to secure, verified freelance payments.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            {[
            {
                step: 1,
                icon: FileCheck,
                title: 'Create Milestone',
                description: 'Client defines deliverables, acceptance criteria, and funds the escrow.'
            },
            {
                step: 2,
                icon: Lock,
                title: 'Work & Submit',
                description: 'Freelancer completes work and submits deliverables with proof.'
            },
            {
                step: 3,
                icon: Brain,
                title: 'AI Verification',
                description: 'Automated verification checks quality, tests, and requirements.'
            },
            {
                step: 4,
                icon: CheckCircle2,
                title: 'Payment Release',
                description: 'Verified work triggers automatic payment to the freelancer.'
            }
        ].map((item, index) => (<div key={item.step} className="relative">
                {index < 3 && (<div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-primary/50 to-transparent"/>)}
                <div className="glass-card rounded-2xl p-6 border border-border relative">
                  <div className="absolute -top-4 -left-4 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                    {item.step}
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                    <item.icon className="h-6 w-6 text-primary"/>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 particles-bg opacity-50"/>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
            Join freelancers and clients using Aegistra for secure,
            transparent payments.
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 cyan-glow gap-2 px-8 h-14 text-lg" onClick={() => setWalletModalOpen(true)}>
            <Wallet className="h-5 w-5"/>
            Connect Wallet
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <Image
                src={AEGISTRA_LOGO}
                alt="Aegistra"
                width={48}
                height={48}
                className="h-12 w-12 rounded-lg object-cover"
              />
              <span className="text-xl font-bold text-foreground">Aegistra</span>
            </div>
            
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span>Built with</span>
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">Next.js</span>
                <span className="text-muted-foreground">+</span>
                <span className="font-medium text-foreground">ethers.js</span>
                <span className="text-muted-foreground">+</span>
                <span className="font-medium text-foreground">Tailwind CSS</span>
              </span>
            </div>

            <p className="text-sm text-muted-foreground">
              {currentYear} Aegistra. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      <WalletModal open={walletModalOpen} onOpenChange={setWalletModalOpen}/>
    </div>);
}
