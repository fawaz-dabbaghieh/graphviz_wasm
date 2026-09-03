//***************************************************************************
//* Copyright (c) 2015 Saint Petersburg State University
//* Copyright (c) 2011-2014 Saint Petersburg Academic University
//* All Rights Reserved
//* See file LICENSE for details.
//***************************************************************************

#pragma once

#include <cassert>

#define VERIFY(expr) do { assert(expr); } while(0);

#ifdef SPADES_ENABLE_EXPENSIVE_CHECKS
# define VERIFY_DEV(expr) VERIFY(expr)
#else
# define VERIFY_DEV(expr) (void)(true ? (void)0 : ((void)(expr)));
#endif
