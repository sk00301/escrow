'use client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWallet } from '@/contexts/wallet-context';
import { Wallet, Loader2 } from 'lucide-react';
export function WalletModal({ open, onOpenChange }) {
    const { connectWallet, isConnecting } = useWallet();
    const handleConnect = async (type) => {
        await connectWallet(type);
        onOpenChange(false);
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card sm:max-w-md border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            Connect Wallet
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col gap-4 py-4">
          <Button variant="outline" className="h-16 justify-start gap-4 border-border bg-muted/50 hover:bg-muted hover:border-primary transition-all duration-200" onClick={() => handleConnect('metamask')} disabled={isConnecting}>
            {isConnecting ? (<Loader2 className="h-8 w-8 animate-spin text-primary"/>) : (<svg viewBox="0 0 40 40" className="h-8 w-8">
                <path fill="#E17726" d="M38.17 3.28L23.72 14.14l2.67-6.3 11.78-4.56z"/>
                <path fill="#E27625" d="M1.83 3.28l14.31 10.96-2.53-6.4L1.83 3.28zM32.96 28.47l-3.84 5.87 8.22 2.26 2.36-8.01-6.74-.12zM.32 28.59l2.34 8.01 8.2-2.26-3.82-5.87-6.72.12z"/>
                <path fill="#E27625" d="M10.47 17.32l-2.29 3.46 8.16.37-.29-8.78-5.58 4.95zM29.53 17.32l-5.66-5.05-.19 8.88 8.14-.37-2.29-3.46zM10.86 34.34l4.91-2.4-4.24-3.31-.67 5.71zM24.23 31.94l4.91 2.4-.67-5.71-4.24 3.31z"/>
                <path fill="#D5BFB2" d="M29.14 34.34l-4.91-2.4.4 3.21-.04 1.35 4.55-2.16zM10.86 34.34l4.55 2.16-.03-1.35.38-3.21-4.9 2.4z"/>
                <path fill="#233447" d="M15.5 26.52l-4.08-1.2 2.88-1.32 1.2 2.52zM24.5 26.52l1.2-2.52 2.9 1.32-4.1 1.2z"/>
                <path fill="#CC6228" d="M10.86 34.34l.7-5.87-4.52.12 3.82 5.75zM28.44 28.47l.7 5.87 3.82-5.75-4.52-.12zM31.82 20.78l-8.14.37.76 4.17 1.2-2.52 2.9 1.32 3.28-3.34zM11.42 24.12l2.88-1.32 1.2 2.52.76-4.17-8.16-.37 3.32 3.34z"/>
                <path fill="#E27525" d="M8.1 20.78l3.44 6.71-.12-3.37-3.32-3.34zM28.58 24.12l-.14 3.37 3.38-6.71-3.24 3.34zM16.26 21.15l-.76 4.17.95 4.91.22-6.47-.41-2.61zM23.68 21.15l-.39 2.59.2 6.49.95-4.91-.76-4.17z"/>
                <path fill="#F5841F" d="M24.44 25.32l-.95 4.91.68.47 4.24-3.31.14-3.37-4.11 1.3zM11.42 24.12l.12 3.37 4.24 3.31.68-.47-.95-4.91-4.09-1.3z"/>
                <path fill="#C0AC9D" d="M24.53 36.5l.04-1.35-.37-.31h-8.4l-.35.31.03 1.35-4.55-2.16 1.59 1.3 3.23 2.24h8.52l3.25-2.24 1.59-1.3-4.58 2.16z"/>
                <path fill="#161616" d="M24.23 31.94l-.68-.47h-7.1l-.68.47-.38 3.21.35-.31h8.4l.37.31-.28-3.21z"/>
                <path fill="#763E1A" d="M38.99 15.01l1.23-5.93L38.17 3.28l-13.94 10.36 5.36 4.53 7.58 2.21 1.68-1.95-.73-.53 1.16-1.06-.89-.69 1.16-.88-.76-.58zM-.22 9.08l1.24 5.93-.79.58 1.17.88-.89.69 1.16 1.06-.73.53 1.67 1.95 7.58-2.21 5.36-4.53L1.61 3.6-.22 9.08z"/>
                <path fill="#F5841F" d="M37.17 20.38l-7.58-2.21 2.29 3.46-3.38 6.71 4.46-.06h6.72l-2.51-7.9zM10.47 18.17l-7.58 2.21-2.51 7.9h6.72l4.44.06-3.44-6.71 2.37-3.46zM23.68 21.15l.48-8.36 2.19-5.92H13.65l2.19 5.92.48 8.36.18 2.63.02 6.45h7.1l.02-6.45.04-2.63z"/>
              </svg>)}
            <div className="flex flex-col items-start">
              <span className="font-semibold text-foreground">MetaMask</span>
              <span className="text-sm text-muted-foreground">
                Connect using browser extension
              </span>
            </div>
          </Button>

          <Button variant="outline" className="h-16 justify-start gap-4 border-border bg-muted/50 hover:bg-muted hover:border-primary transition-all duration-200" onClick={() => handleConnect('walletconnect')} disabled={isConnecting}>
            {isConnecting ? (<Loader2 className="h-8 w-8 animate-spin text-primary"/>) : (<Wallet className="h-8 w-8 text-[#3B99FC]"/>)}
            <div className="flex flex-col items-start">
              <span className="font-semibold text-foreground">WalletConnect</span>
              <span className="text-sm text-muted-foreground">
                Scan with your mobile wallet
              </span>
            </div>
          </Button>

          <p className="text-xs text-center text-muted-foreground mt-2">
            By connecting, you agree to our Terms of Service and Privacy Policy.
            {isConnecting && ' Connecting...'}
          </p>
        </div>
      </DialogContent>
    </Dialog>);
}
