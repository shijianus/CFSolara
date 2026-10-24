<script setup lang="ts">
import { playlistDetail, playlistTrackAll, commentNew, search } from '@/api'
import { usePlayActions } from '@/composables/usePlayActions'
import { PlaylistInfo, CommentItem } from '@/typings'
import LazyImage from '@/components/Ui/LazyImage.vue'
import Button from '@/components/Ui/Button.vue'
import TabGroup from '@/components/Ui/TabGroup.vue'
import InfiniteScroll from '@/components/Ui/InfiniteScroll.vue'
import { formatCount } from '@/utils/time'
import { useI18n } from 'vue-i18n'
import {
  transformPlaylistDetail,
  transformSongs,
  transformSearchPlaylists,
  type SongData,
} from '@/utils/transformers'
import { formatCoverUrl } from '@/utils/imageUrl'
import { useLibraryStore } from '@/stores/modules/library'

const route = useRoute()
const playlistId = route.params.id
const libraryStore = useLibraryStore()

interface SimilarPlaylist {
  id: number | string
  name: string
  coverImgUrl: string
  trackCount?: number
  playCount?: number
  creator?: { nickname: string }
}

interface PlaylistState {
  activeTab: 'songs' | 'comments' | 'similar'
  playlistInfo: PlaylistInfo
  isCollected: boolean
  songs: SongData[]
  comments: CommentItem[]
  isPageLoading: boolean
  similarPlaylists: SimilarPlaylist[]
  commentPage: number
  hasMoreComments: boolean
  isLoadingMoreComments: boolean
  isCommentLoadError: boolean
  commentTotal: number
  songTotal: number
  hasMoreSongs: boolean
  isLoadingMoreSongs: boolean
  isSongLoadError: boolean
  isPreparingFullList: boolean
  partialPlayNotice: string
}

const state = reactive<PlaylistState>({
  activeTab: 'songs',
  playlistInfo: {} as PlaylistInfo,
  isCollected: false,
  songs: [],
  comments: [],
  isPageLoading: true,
  similarPlaylists: [],
  commentPage: 1,
  hasMoreComments: true,
  isLoadingMoreComments: false,
  isCommentLoadError: false,
  commentTotal: 0,
  songTotal: 0,
  hasMoreSongs: false,
  isLoadingMoreSongs: false,
  isSongLoadError: false,
  isPreparingFullList: false,
  partialPlayNotice: '',
})
const {
  activeTab,
  playlistInfo,
  songs,
  comments,
  isPageLoading,
  similarPlaylists,
  hasMoreComments,
  isLoadingMoreComments,
  isCommentLoadError,
  commentTotal,
  songTotal,
  hasMoreSongs,
  isLoadingMoreSongs,
  isSongLoadError,
  isPreparingFullList,
  partialPlayNotice,
} = toRefs(state)
const { playAll: playAllAction, shufflePlay: shufflePlayAction } = usePlayActions()
const { t } = useI18n()

const gradients: string[] = ['from-blue-500 to-sky-500']
const pickGradient = (): string => gradients[Math.floor(Math.random() * gradients.length)]

const SONG_PAGE_SIZE = 100

/** 拉取一页歌曲；reset 为 true 时覆盖，否则按 offset 追加并去重 */
const loadSongPage = async (id: number, offset: number, reset: boolean) => {
  const res = await playlistTrackAll({ id, limit: SONG_PAGE_SIZE, offset })
  const page = transformSongs(res as Record<string, unknown>)
  if (reset) {
    state.songs = page
  } else {
    const seen = new Set(state.songs.map(s => String(s.id)))
    state.songs.push(...page.filter(s => !seen.has(String(s.id))))
  }
  const reachedTotal = state.songTotal > 0 && state.songs.length >= state.songTotal
  state.hasMoreSongs = !reachedTotal && page.length === SONG_PAGE_SIZE
  state.isSongLoadError = false
}

const loadPlaylist = async (id: number) => {
  state.songs = []
  state.songTotal = 0
  state.hasMoreSongs = false
  state.isLoadingMoreSongs = false
  state.isSongLoadError = false
  state.partialPlayNotice = ''
  try {
    const [detailRes, tracksRes] = await Promise.all([
      playlistDetail({ id }),
      playlistTrackAll({ id, limit: SONG_PAGE_SIZE, offset: 0 }),
    ])

    const detail = transformPlaylistDetail(detailRes as Record<string, unknown>, t('home.playlistFallback'))
    if (detail) {
      state.playlistInfo = {
        name: detail.name,
        description: detail.description,
        creator: detail.creator,
        creatorAvatar: detail.creatorAvatar,
        createTime: detail.createTime,
        songCount: detail.songCount,
        playCount: detail.playCount as number,
        likes: String(detail.likes),
        category: detail.category,
        emoji: state.playlistInfo.emoji,
        gradient: pickGradient(),
        coverImgUrl: detail.coverImgUrl,
      }
      state.songTotal = detail.songCount
      state.isCollected = libraryStore.isPlaylistCollected(id)
    }

    state.songs = transformSongs(tracksRes as Record<string, unknown>)
    const reachedTotal = state.songTotal > 0 && state.songs.length >= state.songTotal
    state.hasMoreSongs = !reachedTotal && state.songs.length === SONG_PAGE_SIZE
  } catch {
    state.isSongLoadError = true
  } finally {
    state.isPageLoading = false
  }
}

/** 追加下一页歌曲 */
const loadMoreSongs = async () => {
  if (state.isLoadingMoreSongs || !state.hasMoreSongs) return
  state.isLoadingMoreSongs = true
  try {
    await loadSongPage(Number(route.params.id), state.songs.length, false)
  } catch {
    state.isSongLoadError = true
  } finally {
    state.isLoadingMoreSongs = false
  }
}

/** 播放/随机前确保完整列表已入队，失败时返回 false 以便提示仅播放已加载部分 */
const ensureAllSongsLoaded = async () => {
  if (!state.songs.length || !state.hasMoreSongs) return true
  state.isPreparingFullList = true
  try {
    while (state.hasMoreSongs) {
      const before = state.songs.length
      await loadSongPage(Number(route.params.id), before, false)
      if (state.songs.length === before) break
    }
    return !state.hasMoreSongs
  } catch {
    state.isSongLoadError = true
    return false
  } finally {
    state.isPreparingFullList = false
  }
}

const handlePlayAll = async () => {
  const complete = await ensureAllSongsLoaded()
  if (!complete && state.songs.length) {
    state.partialPlayNotice = t('playlist.partialPlayNotice', {
      loaded: state.songs.length,
      total: state.songTotal || state.songs.length,
    })
  } else {
    state.partialPlayNotice = ''
  }
  playAllAction(state.songs)
}

const handleShufflePlay = async () => {
  const complete = await ensureAllSongsLoaded()
  if (!complete && state.songs.length) {
    state.partialPlayNotice = t('playlist.partialPlayNotice', {
      loaded: state.songs.length,
      total: state.songTotal || state.songs.length,
    })
  } else {
    state.partialPlayNotice = ''
  }
  shufflePlayAction(state.songs)
}

const dismissPartialPlayNotice = () => {
  state.partialPlayNotice = ''
}

let commentRequestSeq = 0

const resetCommentState = () => {
  commentRequestSeq += 1
  state.comments = []
  state.commentPage = 1
  state.hasMoreComments = true
  state.isLoadingMoreComments = false
  state.isCommentLoadError = false
  state.commentTotal = 0
}

const loadComments = async (id?: number, reset = false) => {
  const targetId = id || Number(playlistId)
  if (!targetId) return
  if (!reset && (state.isLoadingMoreComments || !state.hasMoreComments)) return

  if (reset) {
    resetCommentState()
  } else {
    state.isLoadingMoreComments = true
  }
  const requestSeq = commentRequestSeq
  const pageNo = state.commentPage
  state.isCommentLoadError = false

  try {
    const res = await commentNew({
      id: targetId,
      type: 2,
      sortType: 1,
      pageNo,
      pageSize: 20,
    })
    if (requestSeq !== commentRequestSeq) return
    const list = (res as any)?.data?.comments || (res as any)?.comments || []
    if (Array.isArray(list)) {
      const mapped = list.map((c: any, i: number) => ({
        username: c?.user?.nickname || t('comments.user'),
        avatarGradient: gradients[(state.comments.length + i) % gradients.length],
        time: c?.time ? new Date(c.time).toLocaleString() : '',
        content: c?.content || '',
        likes: c?.likedCount || 0,
        avatarUrl: c?.user?.avatarUrl || '',
        replies: (c?.beReplied || []).map((r: any, ri: number) => ({
          username: r?.user?.nickname || t('comments.user'),
          avatarUrl: r?.user?.avatarUrl || '',
          avatarGradient: gradients[(state.comments.length + i + ri + 1) % gradients.length],
          time: '',
          content: r?.content || '',
        })),
      }))

      state.comments = reset ? mapped : [...state.comments, ...mapped]
      state.hasMoreComments = list.length === 20
      const total = Number(
        (res as any)?.data?.total ??
          (res as any)?.total ??
          (res as any)?.data?.totalCount ??
          (res as any)?.totalCount
      )
      if (Number.isFinite(total)) {
        state.commentTotal = total
      } else if (reset) {
        state.commentTotal = mapped.length
      }
      if (mapped.length) state.commentPage += 1
    } else {
      state.hasMoreComments = false
      if (reset) state.commentTotal = 0
    }
  } catch {
    if (requestSeq !== commentRequestSeq) return
    if (!reset) {
      state.isCommentLoadError = true
    } else {
      state.hasMoreComments = false
    }
  } finally {
    if (requestSeq === commentRequestSeq) {
      state.isLoadingMoreComments = false
    }
  }
}

const loadSimilarPlaylists = async (name: string) => {
  try {
    const res = await search({ keywords: name, type: 1000 })
    const { playlists } = transformSearchPlaylists(res as Record<string, unknown>, 12)
    state.similarPlaylists = playlists.map(pl => ({
      id: pl.id,
      name: pl.name,
      coverImgUrl: pl.coverImgUrl,
      trackCount: pl.trackCount,
      playCount: pl.playCount,
    }))
  } catch {}
}

// 初始化加载播放列表
onMounted(() => {
  const idNum = Number(playlistId)
  if (!Number.isNaN(idNum) && idNum > 0) {
    state.isPageLoading = true
    resetCommentState()
    loadPlaylist(idNum)
    loadComments(idNum, true)
  }
})

// 监听路由参数变化，加载新的播放列表
watch(
  () => Number(route.params.id),
  idNum => {
    if (!Number.isNaN(idNum) && idNum > 0) {
      state.isPageLoading = true
      resetCommentState()
      loadPlaylist(idNum)
      loadComments(idNum, true)
    }
  }
)

watch(
  () => state.playlistInfo.name,
  name => {
    if (name) loadSimilarPlaylists(name)
  }
)


const toggleCollect = () => {
  if (!state.playlistInfo) return
  const collected = libraryStore.toggleCollectPlaylist({
    id: Number(playlistId),
    name: state.playlistInfo.name,
    coverImgUrl: state.playlistInfo.coverImgUrl,
    trackCount: state.playlistInfo.songCount,
    creator: state.playlistInfo.creator,
    playCount: state.playlistInfo.playCount,
  })
  state.isCollected = collected
}

const sharePlaylist = async () => {
  const url = location.origin + location.pathname + `#/playlist/${playlistId}`
  const title = String((state.playlistInfo as any)?.name || t('home.playlistFallback'))
  const text = String((state.playlistInfo as any)?.description || '')
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url })
    } else {
      await navigator.clipboard.writeText(url)
    }
  } catch {}
}

const tabs = [
  { key: 'songs', labelKey: 'playlist.tabs.songs', icon: 'icon-[mdi--music-note]' },
  { key: 'comments', labelKey: 'playlist.tabs.comments', icon: 'icon-[mdi--comment-text]' },
  { key: 'similar', labelKey: 'playlist.tabs.similar', icon: 'icon-[mdi--playlist-music]' },
] as const

const tabsWithCount = computed(() =>
  tabs.map(tab => ({
    ...tab,
    count:
      tab.key === 'songs'
        ? songTotal.value || songs.value.length
        : tab.key === 'comments'
          ? commentTotal.value || comments.value.length
          : similarPlaylists.value.length,
  }))
)
</script>

<template>
  <div class="w-full h-full overflow-y-auto p-4 sm:p-6 pb-6 overflow-x-hidden">
    <PageSkeleton v-if="isPageLoading" :sections="['hero', 'list']" :list-count="12" />
    <template v-else>
      <div class="flex flex-col gap-3">
        <!-- 头部区域 -->
        <div class="relative">
          <!-- 背景模糊图片 -->
          <div class="absolute inset-0 overflow-hidden rounded-3xl">
            <img
              :src="formatCoverUrl(playlistInfo.coverImgUrl, { size: 100 })"
              class="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
              alt=""
              aria-hidden="true"
              referrerpolicy="no-referrer"
            />
            <div
              class="to-overlay absolute inset-0 bg-linear-to-b from-transparent via-transparent"
            ></div>
          </div>

          <!-- 内容区域 -->
          <div class="relative z-10 overflow-hidden rounded-3xl">
            <div class="glass-container">
              <div class="flex flex-col gap-6 p-6 lg:flex-row lg:gap-10">
                <!-- 封面 -->
                <div class="group relative mx-auto w-56 shrink-0 lg:mx-0 lg:w-72">
                  <div
                    class="aspect-square overflow-hidden rounded-3xl shadow-2xl ring-1 ring-glass"
                  >
                    <LazyImage
                      :src="formatCoverUrl(playlistInfo.coverImgUrl, { size: 400 })"
                      :alt="$t('components.songList.coverAlt')"
                      imgClass="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                      wrapperClass="h-full w-full"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="none"
                    class="absolute! inset-0 flex items-center justify-center rounded-3xl opacity-0 transition-all duration-300 group-hover:opacity-100"
                    :aria-label="$t('actions.playAll')"
                    :title="$t('actions.playAll')"
                    @click="handlePlayAll"
                  >
                    <div
                      class="flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-r from-sky-500 to-blue-600 text-white shadow-2xl transition-transform hover:scale-110"
                    >
                      <span class="icon-[mdi--play] h-10 w-10"></span>
                    </div>
                  </Button>
                </div>

                <!-- 信息区域 -->
                <div class="flex min-w-0 flex-1 flex-col justify-center text-center lg:text-left">
                  <!-- 标题 -->
                  <h1
                    class="text-primary mb-4 line-clamp-2 text-xl leading-tight font-bold lg:text-4xl xl:text-5xl"
                  >
                    {{ playlistInfo.name }}
                  </h1>

                  <!-- 创建者信息 -->
                  <div class="mb-5 flex items-center justify-center gap-3 lg:justify-start">
                    <img
                      v-if="playlistInfo.creatorAvatar"
                      :src="formatCoverUrl(playlistInfo.creatorAvatar, { size: 80 })"
                      class="h-8 w-8 rounded-full ring-2 ring-glass"
                      :alt="playlistInfo.creator"
                      referrerpolicy="no-referrer"
                    />
                    <span class="text-primary font-medium">{{ playlistInfo.creator }}</span>
                    <span class="text-primary/40">•</span>
                    <span class="text-primary/60 text-sm">{{ playlistInfo.createTime }}</span>
                    <span class="text-primary/40">•</span>
                    <!-- 分类标签 -->
                    <span
                      class="glass-button accent-gradient px-4 py-1.5 text-xs font-medium text-white"
                    >
                      {{ playlistInfo.category }}
                    </span>
                  </div>

                  <!-- 描述 -->
                  <p
                    v-if="playlistInfo.description"
                    class="text-primary/70 mb-6 line-clamp-2 text-sm leading-relaxed lg:text-base"
                    :title="playlistInfo.description"
                  >
                    {{ playlistInfo.description }}
                  </p>

                  <!-- 统计信息 -->
                  <div
                    class="mb-6 flex flex-wrap items-center justify-center gap-6 lg:justify-start"
                  >
                    <div class="flex items-center gap-2">
                      <span class="icon-[mdi--music-note] text-primary/60 h-5 w-5"></span>
                      <span class="text-primary font-medium">
                        {{ $t('commonUnits.songsShort', playlistInfo.songCount) }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="icon-[mdi--play-circle-outline] text-primary/60 h-5 w-5"></span>
                      <span class="text-primary font-medium">
                        {{ formatCount(playlistInfo.playCount || 0) }}
                        {{ $t('common.stats.plays') }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="icon-[mdi--heart] h-5 w-5 text-red-400"></span>
                      <span class="text-primary font-medium">
                        {{ formatCount(Number(playlistInfo.likes) || 0) }}
                        {{ $t('common.stats.favorites') }}
                      </span>
                    </div>
                  </div>

                  <!-- 操作按钮 -->
                  <div class="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                    <Button
                      variant="solid"
                      size="md"
                      rounded="full"
                      class="px-8 py-3 shadow-lg shadow-sky-500/30 hover:shadow-xl hover:shadow-sky-500/40"
                      @click="handlePlayAll"
                    >
                      <span class="icon-[mdi--play] mr-2 h-5 w-5"></span>
                      {{ $t('actions.playAll') }}
                    </Button>
                    <Button
                      variant="soft"
                      size="md"
                      rounded="full"
                      class="px-6 py-3"
                      @click="handleShufflePlay"
                    >
                      <span class="icon-[mdi--shuffle] mr-2 h-5 w-5"></span>
                      {{ $t('actions.shufflePlay') }}
                    </Button>
                    <div class="flex items-center gap-3">
                      <Button
                        variant="soft"
                        size="icon-md"
                        rounded="full"
                        class="h-11 w-11"
                        :class="{
                          'bg-red-500/20 text-red-400 hover:bg-red-500/30': state.isCollected,
                        }"
                        @click="toggleCollect"
                        :title="state.isCollected ? $t('common.uncollect') : $t('common.collect')"
                      >
                        <span
                          :class="
                            state.isCollected ? 'icon-[mdi--heart]' : 'icon-[mdi--heart-outline]'
                          "
                          class="h-5 w-5"
                        ></span>
                      </Button>
                      <Button
                        variant="soft"
                        size="icon-md"
                        rounded="full"
                        class="h-11 w-11"
                        @click="sharePlaylist"
                        :title="$t('common.share')"
                      >
                        <span class="icon-[mdi--share-variant] h-5 w-5"></span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 主内容区域 -->
        <!-- Tabs 工具栏 -->
        <div class="flex items-center justify-between">
          <TabGroup v-model="activeTab" :tabs="tabsWithCount" class="w-full" size="md" />
        </div>

        <!-- 歌曲列表 -->
        <section v-show="activeTab === 'songs'" class="h-full overflow-hidden">
          <div
            v-if="partialPlayNotice"
            class="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-primary/80"
            role="status"
          >
            <span class="icon-[mdi--alert-outline] mt-0.5 h-4 w-4 shrink-0 text-amber-400"></span>
            <span class="flex-1">{{ partialPlayNotice }}</span>
            <button
              type="button"
              class="min-h-11 min-w-11 shrink-0 rounded-lg px-2 text-xs font-medium text-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-sky-400/60"
              @click="dismissPartialPlayNotice"
            >
              {{ $t('playlist.dismiss') }}
            </button>
          </div>
          <SongList :songs="songs" :show-header="true" />
          <div class="mt-4 flex flex-col items-center gap-2 pb-4">
            <p v-if="songTotal" class="text-primary/50 text-xs">
              {{ $t('playlist.loadedProgress', { loaded: songs.length, total: songTotal }) }}
            </p>
            <Button
              v-if="hasMoreSongs"
              variant="soft"
              size="sm"
              rounded="full"
              class="min-h-11"
              :loading="isLoadingMoreSongs || isPreparingFullList"
              :disabled="isLoadingMoreSongs || isPreparingFullList"
              @click="loadMoreSongs"
            >
              {{ isLoadingMoreSongs || isPreparingFullList ? $t('playlist.loadingAll') : $t('playlist.loadMore') }}
            </Button>
            <p v-else-if="songs.length" class="text-primary/40 text-xs">
              {{ $t('playlist.allLoaded') }}
            </p>
            <button
              v-if="isSongLoadError && !isLoadingMoreSongs"
              type="button"
              class="min-h-11 rounded-lg px-3 text-xs font-medium text-sky-400 hover:text-sky-300 focus-visible:ring-2 focus-visible:ring-sky-400/60"
              @click="loadMoreSongs"
            >
              {{ $t('playlist.retryLoad') }}
            </button>
          </div>
        </section>

        <!-- 评论区 -->
        <section v-show="activeTab === 'comments'" class="animate-fade-in">
          <div class="glass-card overflow-hidden">
            <!-- 评论列表（只读，无后端写接口） -->
            <div v-if="comments.length" class="divide-y divide-glass">
              <div
                v-for="(comment, index) in comments"
                :key="index"
                class="hover:bg-hover-glass p-6 transition-colors"
              >
                <div class="flex gap-4">
                  <img
                    v-if="comment.avatarUrl"
                    :src="formatCoverUrl(comment.avatarUrl, { size: 100 })"
                    class="h-11 w-11 shrink-0 rounded-full ring-2 ring-glass"
                    referrerpolicy="no-referrer"
                  />
                  <div
                    v-else
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br text-sm font-semibold text-white"
                    :class="comment.avatarGradient"
                  >
                    {{ comment.username.charAt(0) }}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="mb-2 flex items-center gap-3">
                      <span class="text-primary text-sm font-semibold">{{ comment.username }}</span>
                      <span class="text-primary/50 text-xs">{{ comment.time }}</span>
                    </div>

                    <p class="text-primary/80 mb-4 text-sm leading-relaxed">
                      {{ comment.content }}
                    </p>

                    <div class="flex items-center gap-1.5 text-xs text-primary/50">
                      <span class="icon-[mdi--thumb-up-outline] h-4 w-4"></span>
                      <span class="font-medium">{{ comment.likes || 0 }}</span>
                    </div>

                    <!-- 回复列表 -->
                    <div
                      v-if="comment.replies?.length"
                      class="glass-card mt-4 space-y-3 rounded-xl p-4"
                    >
                      <div v-for="(reply, ri) in comment.replies" :key="ri" class="flex gap-3">
                        <img
                          v-if="reply.avatarUrl"
                          :src="formatCoverUrl(reply.avatarUrl, { size: 80 })"
                          class="h-8 w-8 shrink-0 rounded-full ring-1 ring-glass"
                          referrerpolicy="no-referrer"
                        />
                        <div class="min-w-0 flex-1">
                          <span class="text-primary text-xs font-semibold">{{
                            reply.username
                          }}</span>
                          <p class="text-primary/70 mt-1 text-xs leading-relaxed">
                            {{ reply.content }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="flex flex-col items-center justify-center py-20">
              <span class="icon-[mdi--comment-off-outline] text-primary/20 mb-4 h-16 w-16"></span>
              <p class="text-primary/50 text-sm font-medium">{{ $t('comments.empty') }}</p>
            </div>

            <!-- 评论流式自动触底加载与超时重试 -->
            <InfiniteScroll
              v-if="comments.length || isLoadingMoreComments || isCommentLoadError"
              :loading="isLoadingMoreComments"
              :has-more="hasMoreComments"
              :error="isCommentLoadError"
              :empty="false"
              :loading-text="$t('comments.loadMore')"
              :retry-text="$t('comments.loadMore')"
              @load="loadComments(undefined, false)"
              @retry="loadComments(undefined, false)"
            />
          </div>
        </section>

        <!-- 相似歌单 -->
        <section v-show="activeTab === 'similar'" class="animate-fade-in">
          <div
            v-if="similarPlaylists.length"
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            <router-link
              v-for="pl in similarPlaylists"
              :key="pl.id"
              :to="`/playlist/${pl.id}`"
              class="group"
            >
              <div
                class="glass-card overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl"
              >
                <div class="relative aspect-square overflow-hidden">
                  <LazyImage
                    :src="formatCoverUrl(pl.coverImgUrl, { size: 300 })"
                    :alt="pl.name"
                    imgClass="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    wrapperClass="h-full w-full"
                  />
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100"
                  >
                    <div
                      class="accent-gradient flex h-14 w-14 items-center justify-center rounded-full shadow-2xl"
                    >
                      <span class="icon-[mdi--play] h-7 w-7 text-white"></span>
                    </div>
                  </div>
                  <div
                    v-if="pl.playCount"
                    class="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md"
                  >
                    <span class="icon-[mdi--play] h-3.5 w-3.5"></span>
                    {{ formatCount(pl.playCount) }}
                  </div>
                </div>
                <div class="p-3">
                  <p
                    class="text-primary mb-1.5 line-clamp-2 text-sm leading-snug font-semibold transition-colors group-hover:text-sky-400"
                  >
                    {{ pl.name }}
                  </p>
                  <p class="text-primary/60 text-xs">
                    {{ $t('commonUnits.songsShort', { count: pl.trackCount || 0 }) }}
                    <span v-if="pl.creator"> • {{ pl.creator.nickname }}</span>
                  </p>
                </div>
              </div>
            </router-link>
          </div>
          <div
            v-else
            class="glass-card flex flex-col items-center justify-center py-20 text-center"
          >
            <span class="icon-[mdi--playlist-remove] text-primary/20 mb-5 h-20 w-20"></span>
            <p class="text-primary/50 text-base font-medium">{{ $t('playlist.similarEmpty') }}</p>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
