import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import { defineComponent, h, defineAsyncComponent } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { BRAND_FULL, BRAND_TITLE } from '@/config/brand'

const mode = import.meta.env.VITE_ROUTER_MODE || 'hash'

const routerMode: Record<string, () => ReturnType<typeof createWebHashHistory>> = {
  hash: () => createWebHashHistory(),
  history: () => createWebHistory(),
}

const getHistory = () => {
  const createHistory = routerMode[mode]
  if (typeof createHistory === 'function') {
    return createHistory()
  }
  // 默认使用 hash 模式
  return createWebHashHistory()
}

// 响应式组件工厂：根据窗口尺寸在桌面端与移动端组件之间切换
// desktopLoader 与 mobileLoader 为对应组件的动态导入函数
// 横屏手机（如 844×390）高度不足 500px，即使宽度超过平板阈值也使用移动布局；
// 820×700 平板仍使用桌面布局并启用紧凑底栏。
const responsive = (desktopLoader: () => Promise<any>, mobileLoader: () => Promise<any>) =>
  defineComponent({
    name: 'ResponsiveRouteComponent',
    setup() {
      const isMobile = useMediaQuery('(max-width: 819px), (max-height: 499px)')
      // 异步组件定义，按需加载对应端的页面组件
      const Desktop = defineAsyncComponent(desktopLoader)
      const Mobile = defineAsyncComponent(mobileLoader)
      return () => h(isMobile.value ? Mobile : Desktop)
    },
  })

const router = createRouter({
  history: getHistory(),
  strict: false,
  scrollBehavior: () => ({ left: 0, top: 0 }),
  routes: [
    {
      path: '/',
      // 布局层：根据尺寸切换桌面与移动端布局
      component: responsive(
        () => import('@/layout/index.vue'),
        () => import('@/layout/mobile/index.vue')
      ),
      children: [
        {
          path: '/',
          name: 'home',
          component: responsive(
            () => import('@/pages/index.vue'),
            () => import('@/pages/mobile/index.vue')
          ),
        },
        {
          path: '/playlist/:id',
          name: 'playlist',
          component: responsive(
            () => import('@/pages/playlist.vue'),
            () => import('@/pages/mobile/playlist.vue')
          ),
        },
        {
          path: '/mv-list',
          name: 'mv-list',
          component: responsive(
            () => import('@/pages/mv-list.vue'),
            () => import('@/pages/mobile/mv-list.vue')
          ),
        },
        {
          path: '/mv-player/:id',
          name: 'mv-player',
          component: responsive(
            () => import('@/pages/mv-player.vue'),
            () => import('@/pages/mobile/mv-player.vue')
          ),
        },
        {
          path: '/recent',
          name: 'recent',
          component: responsive(
            () => import('@/pages/recent.vue'),
            () => import('@/pages/mobile/recent.vue')
          ),
        },
        {
          path: '/my-music',
          name: 'my-music',
          component: responsive(
            () => import('@/pages/my-music.vue'),
            () => import('@/pages/mobile/recent.vue')
          ),
        },
        {
          path: '/likes',
          name: 'likes',
          component: responsive(
            () => import('@/pages/likes.vue'),
            () => import('@/pages/mobile/likes.vue')
          ),
        },
        {
          path: '/search',
          name: 'search',
          component: responsive(
            () => import('@/pages/search.vue'),
            () => import('@/pages/mobile/search.vue')
          ),
        },
        {
          path: '/charts',
          name: 'charts',
          component: responsive(
            () => import('@/pages/charts.vue'),
            () => import('@/pages/mobile/charts.vue')
          ),
        },
        {
          path: '/artists',
          name: 'artists',
          component: responsive(
            () => import('@/pages/artists.vue'),
            () => import('@/pages/artists.vue')
          ),
        },
        {
          path: '/new-albums',
          name: 'new-albums',
          component: responsive(
            () => import('@/pages/new-albums.vue'),
            () => import('@/pages/new-albums.vue')
          ),
        },
        {
          path: '/artist/:id',
          name: 'artist',
          component: responsive(
            () => import('@/pages/artist.vue'),
            () => import('@/pages/mobile/artist.vue')
          ),
        },
        {
          path: '/song/:id',
          name: 'song',
          component: responsive(
            () => import('@/pages/song.vue'),
            () => import('@/pages/mobile/song.vue')
          ),
        },
        {
          path: '/album/:id',
          name: 'album',
          component: responsive(
            () => import('@/pages/album.vue'),
            () => import('@/pages/mobile/album.vue')
          ),
        },
        {
          path: '/downloads',
          name: 'downloads',
          component: responsive(
            () => import('@/pages/downloads.vue'),
            () => import('@/pages/mobile/downloads.vue')
          ),
        },
        {
          path: '/local-music',
          name: 'local-music',
          component: responsive(
            () => import('@/pages/local-music.vue'),
            () => import('@/pages/mobile/local-music.vue')
          ),
        },
        {
          path: '/settings',
          name: 'settings',
          component: responsive(
            () => import('@/pages/settings.vue'),
            () => import('@/pages/mobile/settings.vue')
          ),
        },
        {
          path: '/:pathMatch(.*)*',
          name: 'not-found',
          component: () => import('@/pages/not-found.vue'),
        },
      ],
    },
  ],
})

router.onError((error, to) => {
  const msg = error?.message || ''
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed')
  ) {
    if (!sessionStorage.getItem('sonic_chunk_reload')) {
      sessionStorage.setItem('sonic_chunk_reload', '1')
      window.location.href = to.fullPath
    }
  }
})

const routeTitles: Record<string, string> = {
  home: '首页',
  playlist: '歌单详情',
  'mv-list': 'MV 推荐',
  'mv-player': 'MV 播放',
  recent: '最近播放',
  'my-music': '我的音乐',
  likes: '我喜欢的音乐',
  search: '音乐搜索',
  charts: '排行榜',
  artists: '歌手列表',
  artist: '歌手详情',
  'new-albums': '新碟上架',
  song: '歌曲详情',
  album: '专辑详情',
  downloads: '下载管理',
  'local-music': '本地音乐',
  settings: '系统设置',
  'not-found': '404 页面未找到',
}

router.afterEach((to) => {
  if (to.name === 'search' && to.query.q) {
    document.title = `搜索: ${to.query.q} - ${BRAND_FULL}`
    return
  }
  const pageTitle = (to.name && routeTitles[String(to.name)]) || (to.meta?.title as string) || ''
  if (pageTitle) {
    document.title = `${pageTitle} - ${BRAND_FULL}`
  } else {
    document.title = BRAND_TITLE
  }
})

export default router
