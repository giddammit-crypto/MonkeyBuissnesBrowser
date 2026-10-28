package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

const (
	SocketPath = "/run/linuxsec/daemon.sock"
	SocketDir  = "/run/linuxsec"
)

type Request struct {
	Action     string   `json:"action"`
	VpnIface   string   `json:"vpnIface,omitempty"`
	EndpointIP string   `json:"endpointIp,omitempty"`
	DnsServers []string `json:"dnsServers,omitempty"`
}

type Response struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type DaemonServer struct {
	mu          sync.Mutex
	killSwitch  bool
	ipv6Blocked bool
	vpnIface    string
	endpointIP  string
}

func main() {
	if os.Geteuid() != 0 {
		log.Printf("Warning: linuxsecd running without UID 0 (root). Some firewall actions will require root.")
	}

	server := &DaemonServer{}

	if err := os.MkdirAll(SocketDir, 0755); err != nil {
		log.Fatalf("Failed to create socket directory: %v", err)
	}

	// Remove stale socket if exists
	os.Remove(SocketPath)

	listener, err := net.Listen("unix", SocketPath)
	if err != nil {
		log.Fatalf("Failed to bind unix socket %s: %v", SocketPath, err)
	}
	defer os.Remove(SocketPath)
	defer listener.Close()

	// Set socket permissions so desktop users can interact with it
	if err := os.Chmod(SocketPath, 0666); err != nil {
		log.Printf("Failed to chmod socket: %v", err)
	}

	log.Printf("linuxsecd daemon started on %s", SocketPath)

	// Clean up on termination signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Shutting down linuxsecd, cleaning up firewall...")
		server.cleanup()
		os.Remove(SocketPath)
		os.Exit(0)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Accept error: %v", err)
			continue
		}
		go server.handleConnection(conn)
	}
}

func (s *DaemonServer) handleConnection(conn net.Conn) {
	defer conn.Close()

	var req Request
	decoder := json.NewDecoder(conn)
	if err := decoder.Decode(&req); err != nil {
		json.NewEncoder(conn).Encode(Response{
			Success: false,
			Error:   fmt.Sprintf("Invalid JSON request: %v", err),
		})
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var resp Response
	switch req.Action {
	case "enable_killswitch":
		err := s.applyKillSwitch(req.VpnIface, req.EndpointIP)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.killSwitch = true
			s.vpnIface = req.VpnIface
			s.endpointIP = req.EndpointIP
			resp = Response{Success: true, Message: "Kill Switch active"}
		}

	case "disable_killswitch":
		err := s.removeKillSwitch()
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.killSwitch = false
			resp = Response{Success: true, Message: "Kill Switch disabled"}
		}

	case "block_ipv6":
		err := s.setIpv6Block(true)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.ipv6Blocked = true
			resp = Response{Success: true, Message: "IPv6 traffic blocked"}
		}

	case "unblock_ipv6":
		err := s.setIpv6Block(false)
		if err != nil {
			resp = Response{Success: false, Error: err.Error()}
		} else {
			s.ipv6Blocked = false
			resp = Response{Success: true, Message: "IPv6 traffic unblocked"}
		}

	case "status":
		resp = Response{
			Success: true,
			Message: fmt.Sprintf("KillSwitch=%v, IPv6Blocked=%v, Iface=%s", s.killSwitch, s.ipv6Blocked, s.vpnIface),
		}

	default:
		resp = Response{Success: false, Error: fmt.Sprintf("Unknown action: %s", req.Action)}
	}

	json.NewEncoder(conn).Encode(resp)
}

func (s *DaemonServer) applyKillSwitch(vpnIface, endpointIP string) error {
	log.Printf("Applying Kill Switch for iface=%s, endpoint=%s", vpnIface, endpointIP)

	// Clean any previous rules first
	s.removeKillSwitch()

	// Try nftables first
	if _, err := exec.LookPath("nft"); err == nil {
		nftScript := fmt.Sprintf(`
add table inet linuxsec_ks
flush table inet linuxsec_ks
add chain inet linuxsec_ks output { type filter hook output priority 0; policy drop; }
add rule inet linuxsec_ks output oifname "lo" accept
add rule inet linuxsec_ks output ct state established,related accept
add rule inet linuxsec_ks output udp dport 67-68 accept
add rule inet linuxsec_ks output udp sport 67-68 accept
`)
		if endpointIP != "" {
			// Extract host without port
			host := endpointIP
			if idx := strings.LastIndex(host, ":"); idx != -1 {
				host = host[:idx]
			}
			nftScript += fmt.Sprintf("add rule inet linuxsec_ks output ip daddr %s accept\n", host)
		}
		if vpnIface != "" {
			nftScript += fmt.Sprintf("add rule inet linuxsec_ks output oifname \"%s*\" accept\n", vpnIface)
		} else {
			nftScript += "add rule inet linuxsec_ks output oifname \"linuxsec*\" accept\n"
			nftScript += "add rule inet linuxsec_ks output oifname \"wg*\" accept\n"
			nftScript += "add rule inet linuxsec_ks output oifname \"tun*\" accept\n"
		}

		cmd := exec.Command("nft", "-f", "-")
		cmd.Stdin = strings.NewReader(nftScript)
		out, err := cmd.CombinedOutput()
		if err == nil {
			log.Printf("Kill Switch applied with nftables")
			return nil
		}
		log.Printf("nftables failed (%v: %s), falling back to iptables", err, string(out))
	}

	// Fallback to iptables
	cmds := [][]string{
		{"iptables", "-N", "LINUXSEC_KS"},
		{"iptables", "-I", "OUTPUT", "1", "-j", "LINUXSEC_KS"},
		{"iptables", "-A", "LINUXSEC_KS", "-o", "lo", "-j", "ACCEPT"},
		{"iptables", "-A", "LINUXSEC_KS", "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"},
		{"iptables", "-A", "LINUXSEC_KS", "-p", "udp", "--dport", "67:68", "--sport", "67:68", "-j", "ACCEPT"},
	}

	if endpointIP != "" {
		host := endpointIP
		if idx := strings.LastIndex(host, ":"); idx != -1 {
			host = host[:idx]
		}
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-d", host, "-j", "ACCEPT"})
	}

	if vpnIface != "" {
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", vpnIface, "-j", "ACCEPT"})
	} else {
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "linuxsec+", "-j", "ACCEPT"})
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "wg+", "-j", "ACCEPT"})
		cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-o", "tun+", "-j", "ACCEPT"})
	}

	cmds = append(cmds, []string{"iptables", "-A", "LINUXSEC_KS", "-j", "DROP"})

	for _, c := range cmds {
		_ = exec.Command(c[0], c[1:]...).Run()
	}

	return nil
}

func (s *DaemonServer) removeKillSwitch() error {
	// Try nftables removal
	if _, err := exec.LookPath("nft"); err == nil {
		_ = exec.Command("nft", "delete", "table", "inet", "linuxsec_ks").Run()
	}

	// Remove iptables rules if any
	_ = exec.Command("iptables", "-D", "OUTPUT", "-j", "LINUXSEC_KS").Run()
	_ = exec.Command("iptables", "-F", "LINUXSEC_KS").Run()
	_ = exec.Command("iptables", "-X", "LINUXSEC_KS").Run()

	return nil
}

func (s *DaemonServer) setIpv6Block(block bool) error {
	val := "0"
	if block {
		val = "1"
	}
	cmd := exec.Command("sysctl", "-w", fmt.Sprintf("net.ipv6.conf.all.disable_ipv6=%s", val))
	return cmd.Run()
}

func (s *DaemonServer) cleanup() {
	s.removeKillSwitch()
	if s.ipv6Blocked {
		s.setIpv6Block(false)
	}
}

func init() {
	// Ensure directory exists
	_ = os.MkdirAll(filepath.Dir(SocketPath), 0755)
}
